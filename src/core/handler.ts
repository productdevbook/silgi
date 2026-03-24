/**
 * Fetch API handler — single unified request handler.
 *
 * Orchestrates: routing → context → input parsing → pipeline → response encoding.
 * Each concern lives in its own module (codec.ts, input.ts, sse.ts).
 */

import { createContext, releaseContext } from '../compile.ts'
import { compileRouter } from '../compile.ts'
import {
  AnalyticsCollector,
  RequestAccumulator,
  RequestTrace,
  analyticsHTML,
  checkAnalyticsAuth,
  sanitizeHeaders,
  analyticsAuthResponse,
  serveAnalyticsRoute,
} from '../plugins/analytics.ts'
import { generateOpenAPI, scalarHTML } from '../scalar.ts'

import { detectResponseFormat, encodeResponse, makeErrorResponse } from './codec.ts'
import { SilgiError, toSilgiError } from './error.ts'
import { parseInput } from './input.ts'
import { routerCache } from './router-utils.ts'
import { ValidationError } from './schema.ts'
import { iteratorToEventStream } from './sse.ts'

import type { CompiledRoute, CompiledRouterFn } from '../compile.ts'
import type { AnalyticsOptions } from '../plugins/analytics.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { ResponseFormat } from './codec.ts'
import type { Hookable } from 'hookable'

// Re-export for backwards compat
export type { ResponseFormat } from './codec.ts'
export { encodeResponse } from './codec.ts'

// ── Response Builder ────────────────────────────────

/** Wrap a stream to release pooled context on completion or cancellation. */
function wrapStreamWithRelease(
  source: ReadableStream<Uint8Array>,
  ctx: Record<string, unknown>,
): ReadableStream<Uint8Array> {
  let released = false
  const release = () => {
    if (!released) {
      released = true
      releaseContext(ctx)
    }
  }
  const reader = source.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          release()
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch (err) {
        release()
        controller.error(err)
      }
    },
    cancel() {
      release()
      reader.cancel()
    },
  })
}

function makeResponse(
  output: unknown,
  route: CompiledRoute,
  format: ResponseFormat,
  ctx: Record<string, unknown>,
): Response | Promise<Response> {
  if (output instanceof Response) {
    releaseContext(ctx)
    return output
  }
  if (output instanceof ReadableStream) {
    return new Response(wrapStreamWithRelease(output as ReadableStream<Uint8Array>, ctx), {
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
    const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
    return new Response(wrapStreamWithRelease(stream, ctx), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  }

  releaseContext(ctx)

  const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
  if (format !== 'json') {
    return encodeResponse(output, 200, format, cacheHeaders)
  }
  return new Response(JSON.stringify(output), {
    headers: cacheHeaders
      ? { 'content-type': 'application/json', ...cacheHeaders }
      : { 'content-type': 'application/json' },
  })
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Fetch Handler ───────────────────────────────────

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
  handlerOptions?: { scalar?: boolean | ScalarOptions; analytics?: boolean | AnalyticsOptions },
): (request: Request) => Response | Promise<Response> {
  // Compile router
  let compiledRouter = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  const jsonHeaders = { 'content-type': 'application/json' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  // Scalar API docs
  const scalarEnabled = !!handlerOptions?.scalar
  let specJson: string | undefined
  let specHtml: string | undefined
  if (scalarEnabled) {
    const scalarOpts = typeof handlerOptions!.scalar === 'object' ? handlerOptions!.scalar : {}
    specJson = JSON.stringify(generateOpenAPI(routerDef, scalarOpts))
    specHtml = scalarHTML('/openapi.json', scalarOpts)
  }

  // Analytics
  const analyticsEnabled = !!handlerOptions?.analytics
  let collector: AnalyticsCollector | undefined
  let analyticsDashboardHtml: string | undefined
  let analyticsAuth: string | ((req: Request) => boolean | Promise<boolean>) | undefined
  if (analyticsEnabled) {
    const analyticsOpts = typeof handlerOptions!.analytics === 'object' ? handlerOptions!.analytics : {}
    collector = new AnalyticsCollector(analyticsOpts)
    analyticsDashboardHtml = analyticsHTML()
    analyticsAuth = analyticsOpts.auth
  }

  // Hook helper
  function callHook(name: keyof SilgiHooks, event: any): void {
    if (!hooks) return
    try {
      const result = hooks.callHook(name, event)
      if (result instanceof Promise) result.catch(() => {})
    } catch {}
  }

  // ── Unified Request Handler ───────────────────────

  async function handleRequest(request: Request, accumulator?: RequestAccumulator): Promise<Response> {
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    // Scalar routes
    if (scalarEnabled) {
      if (pathname === 'openapi.json')
        return new Response(specJson, { headers: { 'content-type': 'application/json' } })
      if (pathname === 'reference') return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
    }

    // Analytics routes
    if (analyticsEnabled && collector && pathname.startsWith('analytics')) {
      if (analyticsAuth) {
        const authResult = checkAnalyticsAuth(request, analyticsAuth)
        const ok = authResult instanceof Promise ? await authResult : authResult
        if (!ok) return analyticsAuthResponse(pathname)
      }
      return serveAnalyticsRoute(pathname, collector, analyticsDashboardHtml)
    }

    // Route lookup
    const match = compiledRouter!(request.method, fullPath)
    if (!match) return new Response(notFoundBody, { status: 404, headers: jsonHeaders })

    const route = match.data
    const reqMethod = request.method

    // Method enforcement
    if (route.method !== '*' && reqMethod !== route.method && reqMethod !== 'OPTIONS') {
      if (!(reqMethod === 'GET' && route.method === 'POST')) {
        return new Response(
          JSON.stringify({ code: 'METHOD_NOT_ALLOWED', status: 405, message: `Method ${reqMethod} not allowed` }),
          { status: 405, headers: { ...jsonHeaders, allow: route.method } },
        )
      }
    }

    const format = detectResponseFormat(request)
    const ctx = createContext()
    let reqTrace: RequestTrace | undefined
    let rawInput: unknown
    let t0 = 0

    try {
      // Context
      const baseCtxResult = contextFactory(request)
      const baseCtx = baseCtxResult instanceof Promise ? await baseCtxResult : baseCtxResult
      const keys = Object.keys(baseCtx)
      for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      if (match.params) ctx.params = match.params

      // Analytics trace
      if (collector) {
        reqTrace = new RequestTrace()
        ctx.__analyticsTrace = reqTrace
        ctx.trace = reqTrace.trace.bind(reqTrace)
      }

      // Input
      if (!route.passthrough) rawInput = await parseInput(request, url, qMark)

      callHook('request', { path: pathname, input: rawInput })

      // Pipeline
      t0 = collector ? performance.now() : 0
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      // Analytics
      const durationMs = collector ? round(performance.now() - t0) : 0
      callHook('response', { path: pathname, output, durationMs })
      if (collector) {
        collector.record(pathname, durationMs)
        if (accumulator) {
          const isStream =
            output instanceof ReadableStream ||
            (output && typeof output === 'object' && Symbol.asyncIterator in (output as object))
          accumulator.addProcedure({
            procedure: pathname,
            durationMs,
            status: 200,
            input: rawInput,
            output: isStream ? null : output,
            spans: reqTrace?.spans ?? [],
          })
        }
      }

      // Response — makeResponse handles context release for all paths (including streams)
      const response = makeResponse(output, route, format, ctx)
      return response instanceof Promise ? await response : response
    } catch (error) {
      releaseContext(ctx)
      callHook('error', { path: pathname, error })

      if (collector) {
        const durationMs = t0 ? round(performance.now() - t0) : 0
        const errorMsg = error instanceof Error ? error.message : String(error)
        const isValidation = error instanceof ValidationError
        const silgiErr = isValidation ? null : error instanceof SilgiError ? error : toSilgiError(error)
        const errStatus = isValidation ? 400 : (silgiErr?.status ?? 500)

        collector.recordError(pathname, durationMs, errorMsg)
        collector.recordDetailedError({
          requestId: accumulator?.requestId ?? '',
          timestamp: Date.now(),
          procedure: pathname,
          error: errorMsg,
          code: isValidation ? 'BAD_REQUEST' : (silgiErr?.code ?? 'INTERNAL_SERVER_ERROR'),
          status: errStatus,
          stack: error instanceof Error ? (error.stack ?? '').slice(0, 2048) : '',
          input: typeof rawInput === 'string' ? rawInput.slice(0, 4096) : rawInput,
          headers: sanitizeHeaders(request.headers),
          durationMs,
          spans: reqTrace?.spans ?? [],
        })
        if (accumulator) {
          accumulator.addProcedure({
            procedure: pathname,
            durationMs,
            status: errStatus,
            input: rawInput,
            output: null,
            spans: reqTrace?.spans ?? [],
            error: errorMsg,
          })
        }
      }

      const errorResponse = makeErrorResponse(error, format)
      return errorResponse instanceof Promise ? await errorResponse : errorResponse
    }
  }

  // Wrap with analytics headers
  if (!collector) return handleRequest

  return async (request: Request): Promise<Response> => {
    const acc = new RequestAccumulator(request, collector!)
    const response = await handleRequest(request, acc)
    const headers = new Headers(response.headers)
    headers.set('x-request-id', acc.requestId)
    const cookie = acc.getSessionCookie()
    if (cookie) headers.append('set-cookie', cookie)
    const injected = new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    acc.flushWithResponse(injected)
    return injected
  }
}
