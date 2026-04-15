/**
 * Built-in analytics plugin — zero-dependency monitoring with deep error tracing.
 *
 * This module is the public entry point. Implementation lives in ./analytics/.
 *
 * - Per-procedure metrics (count, errors, latency percentiles) via ring buffers
 * - Full error log with input, headers, stack trace, custom spans
 * - `trace()` helper for measuring DB queries, API calls, etc.
 * - HTTP-level request tracking with procedure grouping (batch support)
 * - Unique request IDs via `x-request-id` response header
 *
 * Dashboard at /api/analytics, JSON API at /api/analytics/stats, errors at /api/analytics/errors.
 */

import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'
import { analyticsTraceMap } from '../core/trace-map.ts'
import { parseUrlPathname } from '../core/url.ts'
import { ZodSchemaConverter } from '../integrations/zod/converter.ts'

import { RequestAccumulator } from './analytics/accumulator.ts'
import { AnalyticsCollector } from './analytics/collector.ts'
import { generateRequestId } from './analytics/request-id.ts'
import { analyticsAuthResponse, analyticsHTML, checkAnalyticsAuth, serveAnalyticsRoute } from './analytics/routes.ts'
import { RequestTrace } from './analytics/trace.ts'
import { isTrackedRequestPath, normalizeAnalyticsPath, round, sanitizeHeaders } from './analytics/utils.ts'

import type { FetchHandler } from '../core/handler.ts'
import type { ProcedureDef, RouterDef } from '../types.ts'
import type { AnalyticsOptions, TraceSpan } from './analytics/types.ts'

// ── Re-exports ─────────────────────────────────────

export { AnalyticsCollector } from './analytics/collector.ts'
export { RequestTrace, trace } from './analytics/trace.ts'
export { analyticsHTML, serveAnalyticsRoute } from './analytics/routes.ts'
export { errorToMarkdown, requestToMarkdown } from './analytics/export.ts'
export { sanitizeHeaders } from './analytics/utils.ts'
export { RequestAccumulator } from './analytics/accumulator.ts'
export { checkAnalyticsAuth, analyticsAuthResponse } from './analytics/routes.ts'

export type {
  AnalyticsOptions,
  AnalyticsSnapshot,
  ErrorEntry,
  ProcedureCall,
  ProcedureSnapshot,
  RequestEntry,
  SpanKind,
  TaskExecution,
  TaskSnapshot,
  TraceSpan,
} from './analytics/types.ts'

// ── Response Body Capture ──────────────────────────

async function captureResponseBody(response: Response): Promise<{
  output: unknown
  error?: string
}> {
  const contentType = response.headers.get('content-type') ?? ''
  const lowered = contentType.toLowerCase()

  if (!response.body || lowered.includes('text/event-stream') || lowered.includes('application/octet-stream')) {
    return { output: null }
  }

  try {
    const clone = response.clone()
    const text = await clone.text()
    if (!text) return { output: null }

    let output: unknown = text
    if (lowered.includes('application/json') || lowered.includes('+json')) {
      try {
        output = JSON.parse(text)
      } catch {
        output = text
      }
    }

    if (response.status < 400) return { output }

    if (output && typeof output === 'object') {
      const record = output as Record<string, unknown>
      const message = typeof record.message === 'string' ? record.message : null
      const code = typeof record.code === 'string' ? record.code : null
      if (message && code) return { output, error: `${code}: ${message}` }
      if (message) return { output, error: message }
    }

    return { output, error: typeof output === 'string' ? output : JSON.stringify(output) }
  } catch {
    return { output: null }
  }
}

function extractResponseError(output: unknown, status: number, fallback?: string): { code: string; message: string } {
  if (output && typeof output === 'object') {
    const record = output as Record<string, unknown>
    const code = typeof record.code === 'string' ? record.code : null
    const message = typeof record.message === 'string' ? record.message : null
    if (code && message) return { code, message }
    if (message) return { code: `HTTP_${status}`, message }
  }

  if (fallback) return { code: `HTTP_${status}`, message: fallback }
  return { code: `HTTP_${status}`, message: `Request failed with status ${status}` }
}

// ── Schema Extraction ──────────────────────────────

export interface ProcedureSchemaInfo {
  input?: Record<string, unknown>
  output?: Record<string, unknown>
}

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'resolve' in value &&
    typeof (value as ProcedureDef).resolve === 'function'
  )
}

const _zodConverter = new ZodSchemaConverter()

function schemaToJson(schema: unknown, strategy: 'input' | 'output'): Record<string, unknown> | undefined {
  if (!schema) return undefined
  const std = (schema as any)['~standard']
  if (std?.jsonSchema?.input) {
    try {
      const result = std.jsonSchema.input({ target: 'draft-2020-12' })
      if (result && typeof result === 'object') {
        const { $schema: _, ...rest } = result as Record<string, unknown>
        return rest
      }
    } catch {}
  }
  if (_zodConverter.condition(schema as any)) {
    try {
      const [, json] = _zodConverter.convert(schema as any, { strategy })
      return json as Record<string, unknown>
    } catch {}
  }
  return undefined
}

function extractProcedureSchemas(router: RouterDef): Map<string, ProcedureSchemaInfo> {
  const schemas = new Map<string, ProcedureSchemaInfo>()

  function walk(node: unknown, path: string[]): void {
    if (isProcedureDef(node)) {
      const info: ProcedureSchemaInfo = {}
      if (node.input) info.input = schemaToJson(node.input, 'input')
      if (node.output) info.output = schemaToJson(node.output, 'output')
      if (info.input || info.output) schemas.set(path.join('/'), info)
      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        walk(child, [...path, key])
      }
    }
  }

  walk(router, [])
  return schemas
}

// ── Handler Wrapper ─────────────────────────────────

/**
 * Wrap a fetch handler with analytics collection.
 * Intercepts analytics dashboard routes and instruments every request.
 */
export function wrapWithAnalytics(
  handler: FetchHandler,
  router: RouterDef | undefined,
  options: AnalyticsOptions,
): FetchHandler {
  const collector = new AnalyticsCollector(options)
  const procedureSchemas = router ? extractProcedureSchemas(router) : undefined
  if (procedureSchemas) collector.setProcedureSchemas(procedureSchemas)
  const dashboardHtml = analyticsHTML()
  const auth = options.auth

  if (!auth) {
    throw new Error(
      '[silgi analytics] `options.auth` is required. ' +
        'The analytics dashboard exposes request bodies, headers, and stack traces. ' +
        'Provide an auth token via `analytics: { auth: "your-secret-token" }` to protect it.',
    )
  }

  // Wire task analytics
  import('../core/task.ts').then(({ setTaskAnalytics }) => {
    setTaskAnalytics((entry) => collector.recordTask({ ...entry, spans: (entry.spans ?? []) as TraceSpan[] }))
  })

  return async (request: Request): Promise<Response> => {
    const pathname = parseUrlPathname(request.url)

    // Analytics dashboard routes — accept either `api/analytics*` or bare
    // `analytics*` (depending on adapter prefix). Normalize to the canonical
    // `api/analytics[/sub]` shape so serveAnalyticsRoute's matching is stable.
    const analyticsSub = normalizeAnalyticsPath(pathname)
    if (analyticsSub !== null) {
      const canonical = analyticsSub === '' ? 'api/analytics' : `api/analytics/${analyticsSub}`
      const authResult = checkAnalyticsAuth(request, auth)
      const ok = authResult instanceof Promise ? await authResult : authResult
      if (!ok) return analyticsAuthResponse(canonical)
      return serveAnalyticsRoute(canonical, request, collector, dashboardHtml)
    }

    if (!isTrackedRequestPath(pathname) || collector.isIgnored(pathname)) {
      return handler(request)
    }

    // Trace correlation — propagate or generate trace ID
    const incomingTraceId = request.headers.get('x-trace-id')
    const parentRequestId = request.headers.get('x-parent-request-id')
    const traceId = incomingTraceId || generateRequestId()

    // Instrument the request
    const acc = new RequestAccumulator(request, collector, traceId, parentRequestId ?? undefined)
    const reqTrace = new RequestTrace()
    const t0 = performance.now()

    // Inject trace into request headers so context factory can access it
    // We use a WeakMap to avoid mutating the request
    analyticsTraceMap.set(request, reqTrace)

    let response: Response
    try {
      response = await handler(request)
      const durationMs = round(performance.now() - t0)
      const captured = await captureResponseBody(response)
      const procedureInput = reqTrace.procedureInput ?? null
      const procedureOutput = reqTrace.procedureOutput ?? captured.output
      const procedureSpans = reqTrace.spans ?? []

      collector.record(pathname, durationMs)
      acc.addProcedure({
        procedure: pathname,
        durationMs,
        status: response.status,
        input: procedureInput,
        output: procedureOutput,
        spans: procedureSpans,
        error: captured.error,
      })

      if (response.status >= 400) {
        const { code, message } = extractResponseError(procedureOutput, response.status, captured.error)
        collector.recordError(pathname, durationMs, message)
        collector.recordDetailedError({
          requestId: acc.requestId,
          timestamp: Date.now(),
          procedure: pathname,
          error: message,
          code,
          status: response.status,
          stack: '',
          input: procedureInput,
          headers: sanitizeHeaders(request.headers),
          durationMs,
          spans: procedureSpans,
        })
      }
    } catch (error) {
      const durationMs = round(performance.now() - t0)
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isValidation = error instanceof ValidationError
      const silgiErr = isValidation ? null : error instanceof SilgiError ? error : toSilgiError(error)
      const errStatus = isValidation ? 400 : (silgiErr?.status ?? 500)

      collector.recordError(pathname, durationMs, errorMsg)
      collector.recordDetailedError({
        requestId: acc.requestId,
        timestamp: Date.now(),
        procedure: pathname,
        error: errorMsg,
        code: isValidation ? 'BAD_REQUEST' : (silgiErr?.code ?? 'INTERNAL_SERVER_ERROR'),
        status: errStatus,
        stack: error instanceof Error ? (error.stack ?? '').slice(0, 2048) : '',
        input: null,
        headers: sanitizeHeaders(request.headers),
        durationMs,
        spans: reqTrace.spans ?? [],
      })
      throw error
    } finally {
      analyticsTraceMap.delete(request)
    }

    // Inject analytics headers
    const headers = new Headers(response.headers)
    headers.set('x-request-id', acc.requestId)
    headers.set('x-trace-id', traceId)
    const cookie = acc.getSessionCookie()
    if (cookie) headers.append('set-cookie', cookie)
    const injected = new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    acc.flushWithResponse(injected)
    return injected
  }
}

// Re-export from core — single shared instance, correct dependency direction
export { analyticsTraceMap } from '../core/trace-map.ts'
