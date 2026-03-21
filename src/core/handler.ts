import { ContextPool } from '../compile.ts'
import { compileRouter } from '../compile.ts'
import { AnalyticsCollector, RequestTrace, analyticsHTML } from '../plugins/analytics.ts'
import { generateOpenAPI, scalarHTML } from '../scalar.ts'

import { SilgiError, toSilgiError } from './error.ts'
import { routerCache } from './router-utils.ts'
import { ValidationError } from './schema.ts'
import { iteratorToEventStream } from './sse.ts'
import { stringifyJSON, parseEmptyableJSON } from './utils.ts'

import type { AnalyticsOptions } from '../plugins/analytics.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { Hookable } from 'hookable'

// Lazy-loaded codecs — resolved on first non-JSON request
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

// ── Response Encoding Helper ────────────────────────

export type ResponseFormat = 'json' | 'msgpack' | 'devalue'

export async function encodeResponse(
  data: unknown,
  status: number,
  format: ResponseFormat,
  jsonStringify?: (v: unknown) => string,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  switch (format) {
    case 'msgpack': {
      _msgpack ??= await import('../codec/msgpack.ts')
      return new Response(_msgpack.encode(data), {
        status,
        headers: { 'content-type': _msgpack.MSGPACK_CONTENT_TYPE, ...extraHeaders },
      })
    }
    case 'devalue': {
      _devalue ??= await import('../codec/devalue.ts')
      return new Response(_devalue.encode(data), {
        status,
        headers: { 'content-type': _devalue.DEVALUE_CONTENT_TYPE, ...extraHeaders },
      })
    }
    default:
      return new Response(jsonStringify ? jsonStringify(data) : stringifyJSON(data), {
        status,
        headers: { 'content-type': 'application/json', ...extraHeaders },
      })
  }
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
): (request: Request) => Promise<Response> {
  // Compile router tree into JIT-compiled radix router
  let compiledRouter = routerCache.get(routerDef)
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  // Context pool — zero allocation per request
  const ctxPool = new ContextPool()

  // Pre-allocate response headers and reusable context (reused across requests)
  const jsonHeaders = { 'content-type': 'application/json' }
  const emptyCtx = Object.create(null)
  const sseHeaders = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  // Scalar API docs (lazy init)
  const scalarEnabled = !!handlerOptions?.scalar
  let specJson: string | undefined
  let specHtml: string | undefined
  if (scalarEnabled) {
    const scalarOpts = typeof handlerOptions!.scalar === 'object' ? handlerOptions!.scalar : {}
    specJson = JSON.stringify(generateOpenAPI(routerDef, scalarOpts))
    specHtml = scalarHTML('/openapi.json', scalarOpts)
  }

  // Analytics (sync init — no race condition, module is pure JS with zero deps)
  const analyticsEnabled = !!handlerOptions?.analytics
  let collector: AnalyticsCollector | undefined
  let analyticsDashboardHtml: string | undefined
  if (analyticsEnabled) {
    const analyticsOpts = typeof handlerOptions!.analytics === 'object' ? handlerOptions!.analytics : {}
    collector = new AnalyticsCollector(analyticsOpts)
    analyticsDashboardHtml = analyticsHTML()
  }

  // Pre-check: are hooks actually wired? Skip callHook overhead when nothing listens.
  const hasHooks = !!hooks

  // Runtime detection: Bun's request.json() is native C++ — faster than text() + JSON.parse()
  const isBun = typeof globalThis.Bun !== 'undefined'

  // Pre-check: is context factory sync? Also detect empty context for zero-copy path.
  let ctxFactoryIsSync = false
  let ctxFactoryIsEmpty = false
  try {
    const testResult = contextFactory(new Request('http://localhost'))
    if (testResult instanceof Promise) {
      testResult.then((r) => {
        ctxFactoryIsEmpty = Object.keys(r).length === 0
      })
    } else {
      ctxFactoryIsSync = true
      ctxFactoryIsEmpty = Object.keys(testResult).length === 0
    }
  } catch {}

  function handleRequest(request: Request): Response | Promise<Response> {
    // FAST pathname extraction — 40x faster than new URL()
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    // Keep leading '/' for router, use +1 slice for readable path comparisons
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    // Scalar: /openapi.json and /reference
    if (scalarEnabled) {
      if (pathname === 'openapi.json') {
        return new Response(specJson, { headers: { 'content-type': 'application/json' } })
      }
      if (pathname === 'reference') {
        return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
      }
    }

    // Analytics: /analytics and /analytics/api
    if (analyticsEnabled && collector) {
      if (pathname === 'analytics') {
        return new Response(analyticsDashboardHtml, { headers: { 'content-type': 'text/html' } })
      }
      if (pathname === 'analytics/api') {
        return new Response(JSON.stringify(collector.toJSON()), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
        })
      }
      if (pathname === 'analytics/errors') {
        return new Response(JSON.stringify(collector.getErrors()), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
        })
      }
      if (pathname === 'analytics/requests') {
        return new Response(JSON.stringify(collector.getRequests()), {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
        })
      }
    }

    // Compiled radix router lookup — fullPath already has leading '/'
    const match = compiledRouter!(request.method, fullPath)
    if (!match) {
      return new Response(notFoundBody, { status: 404, headers: jsonHeaders })
    }
    const route = match.data

    // ── Fast sync path: GET, sync context factory, no body ──
    // Avoids async/await overhead entirely for simple queries
    const method = request.method
    if (ctxFactoryIsSync && (method === 'GET' || !request.body)) {
      // Ultra-fast: skip pool when context is empty, no params, no analytics
      const usePool = !ctxFactoryIsEmpty || match.params || collector
      const ctx = usePool ? ctxPool.borrow() : (emptyCtx as Record<string, unknown>)
      try {
        // Skip context factory + keys iteration when factory returns empty object
        if (!ctxFactoryIsEmpty) {
          const baseCtx = contextFactory(request) as Record<string, unknown>
          const keys = Object.keys(baseCtx)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
        }
        if (match.params) ctx.params = match.params

        // Inject trace helper when analytics is enabled
        let reqTrace: RequestTrace | undefined
        if (collector) {
          reqTrace = new RequestTrace()
          ctx.__analyticsTrace = reqTrace
          ctx.trace = reqTrace.trace.bind(reqTrace)
        }

        // Parse GET query input
        let rawInput: unknown
        if (method === 'GET' && qMark !== -1) {
          const searchStr = url.slice(qMark + 1)
          const dataIdx = searchStr.indexOf('data=')
          if (dataIdx !== -1) {
            const valueStart = dataIdx + 5
            const valueEnd = searchStr.indexOf('&', valueStart)
            const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
            rawInput = JSON.parse(decodeURIComponent(encoded))
          }
        }

        if (hasHooks) hooks!.callHook('request', { path: pathname, input: rawInput })

        const t0 = collector ? performance.now() : 0
        const pipelineResult = route.handler(ctx, rawInput, request.signal)

        // Sync pipeline result — fully synchronous response
        if (!(pipelineResult instanceof Promise)) {
          const output = pipelineResult
          if (hasHooks || collector) {
            const durationMs = collector ? round(performance.now() - t0) : 0
            if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs })
            if (collector) {
              collector.record(pathname, durationMs)
              if (reqTrace && reqTrace.spans.length > 0) {
                collector.recordDetailedRequest({
                  timestamp: Date.now(),
                  procedure: pathname,
                  durationMs,
                  status: 200,
                  input: rawInput,
                  spans: reqTrace.spans,
                })
              }
            }
          }

          if (output instanceof Response) return output
          if (output instanceof ReadableStream)
            return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
          if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
            return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), {
              headers: sseHeaders,
            })
          }

          // Content negotiation — check Accept header for non-JSON formats
          const accept = request.headers.get('accept')
          if (accept && (accept.includes('msgpack') || accept.includes('x-devalue'))) {
            const fmt: ResponseFormat = accept.includes('msgpack') ? 'msgpack' : 'devalue'
            const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
            return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
          }

          // JSON fast path — skip content negotiation for most requests
          const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
          return new Response(route.stringify(output), {
            headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
          })
        }

        // Async pipeline result but sync context — partial async
        return pipelineResult
          .then((output) => {
            const durationMs = collector ? round(performance.now() - t0) : 0
            if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs })
            if (collector) {
              collector.record(pathname, durationMs)
              if (reqTrace && reqTrace.spans.length > 0) {
                collector.recordDetailedRequest({
                  timestamp: Date.now(),
                  procedure: pathname,
                  durationMs,
                  status: 200,
                  input: rawInput,
                  spans: reqTrace.spans,
                })
              }
            }
            if (output instanceof Response) return output
            if (output instanceof ReadableStream)
              return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
            if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
              return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), {
                headers: sseHeaders,
              })
            }
            const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
            return new Response(route.stringify(output), {
              headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
            })
          })
          .catch((error) => handleError(error, pathname, request, rawInput, reqTrace))
          .finally(() => { if (usePool) ctxPool.release(ctx) })
      } catch (error) {
        if (usePool) ctxPool.release(ctx)
        return handleError(error, pathname, request, undefined, undefined)
      }
    }

    // ── Full async path: POST with body, async context factory, codecs ──
    return handleAsync(request, url, pathname, qMark, match, route)
  }

  async function handleAsync(
    request: Request,
    url: string,
    pathname: string,
    qMark: number,
    match: NonNullable<ReturnType<typeof compiledRouter>>,
    route: import('../compile.ts').CompiledRoute,
  ): Promise<Response> {
    const ctx = ctxPool.borrow()
    let reqTrace: RequestTrace | undefined
    let rawInput: unknown

    try {
      // Context factory — skip await when sync, skip copy when empty
      if (!ctxFactoryIsEmpty) {
        const baseCtxResult = contextFactory(request)
        const baseCtx = baseCtxResult instanceof Promise ? await baseCtxResult : baseCtxResult
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }
      if (match.params) ctx.params = match.params

      if (collector) {
        reqTrace = new RequestTrace()
        ctx.__analyticsTrace = reqTrace
        ctx.trace = reqTrace.trace.bind(reqTrace)
      }

      // Parse input body
      if (request.method === 'GET') {
        if (qMark !== -1) {
          const searchStr = url.slice(qMark + 1)
          const dataIdx = searchStr.indexOf('data=')
          if (dataIdx !== -1) {
            const valueStart = dataIdx + 5
            const valueEnd = searchStr.indexOf('&', valueStart)
            const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
            rawInput = JSON.parse(decodeURIComponent(encoded))
          }
        }
      } else if (request.body) {
        const ct = request.headers.get('content-type')
        if (ct && ct.charCodeAt(12) !== 106) {
          // Not 'application/json' — check binary codecs (12th char: 'j' = 106)
          if (ct.includes('msgpack')) {
            _msgpack ??= await import('../codec/msgpack.ts')
            const buf = new Uint8Array(await request.arrayBuffer())
            rawInput = buf.length > 0 ? _msgpack.decode(buf) : undefined
          } else if (ct.includes('x-devalue')) {
            _devalue ??= await import('../codec/devalue.ts')
            const text = await request.text()
            rawInput = text ? _devalue.decode(text) : undefined
          } else if (isBun) {
            rawInput = await request.json()
          } else {
            const text = await request.text()
            rawInput = text ? JSON.parse(text) : undefined
          }
        } else if (isBun) {
          rawInput = await request.json()
        } else {
          const text = await request.text()
          rawInput = text ? JSON.parse(text) : undefined
        }
      }

      if (hasHooks) hooks!.callHook('request', { path: pathname, input: rawInput })

      const t0 = collector ? performance.now() : 0
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      if (output instanceof Response) return output
      if (output instanceof ReadableStream)
        return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
      if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
        return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: sseHeaders })
      }

      const durationMs = collector ? round(performance.now() - t0) : 0
      if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs })
      if (collector) {
        collector.record(pathname, durationMs)
        if (reqTrace && reqTrace.spans.length > 0) {
          collector.recordDetailedRequest({
            timestamp: Date.now(),
            procedure: pathname,
            durationMs,
            status: 200,
            input: rawInput,
            spans: reqTrace.spans,
          })
        }
      }

      const accept = request.headers.get('accept')
      if (accept && (accept.includes('msgpack') || accept.includes('x-devalue'))) {
        const fmt: ResponseFormat = accept.includes('msgpack') ? 'msgpack' : 'devalue'
        const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
        return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
      }

      const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
      return new Response(route.stringify(output), {
        headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
      })
    } catch (error) {
      return handleError(error, pathname, request, rawInput, reqTrace) as Response
    } finally {
      ctxPool.release(ctx)
    }
  }

  function handleError(
    error: unknown,
    pathname: string,
    request: Request,
    rawInput: unknown,
    reqTrace: RequestTrace | undefined,
  ): Response | Promise<Response> {
    if (hasHooks) hooks!.callHook('error', { path: pathname, error })
    if (collector) {
      collector.recordError(pathname, 0, error instanceof Error ? error.message : String(error))
      const isValidation = error instanceof ValidationError
      const silgiErr = isValidation ? null : error instanceof SilgiError ? error : toSilgiError(error)
      collector.recordDetailedError({
        timestamp: Date.now(),
        procedure: pathname,
        error: error instanceof Error ? error.message : String(error),
        code: isValidation ? 'BAD_REQUEST' : (silgiErr?.code ?? 'INTERNAL_SERVER_ERROR'),
        status: isValidation ? 400 : (silgiErr?.status ?? 500),
        stack: error instanceof Error ? (error.stack ?? '') : '',
        input: rawInput,
        headers: Object.fromEntries(request.headers),
        durationMs: 0,
        spans: reqTrace?.spans ?? [],
      })
    }

    const accept = request.headers.get('accept')
    const fmt: ResponseFormat = accept?.includes('msgpack')
      ? 'msgpack'
      : accept?.includes('x-devalue')
        ? 'devalue'
        : 'json'
    if (error instanceof ValidationError) {
      const errBody = { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
      return encodeResponse(errBody, 400, fmt)
    }
    const e = error instanceof SilgiError ? error : toSilgiError(error)
    return encodeResponse(e.toJSON(), e.status, fmt)
  }

  return handleRequest
}
