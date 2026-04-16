/**
 * Fetch API handler — single unified request handler.
 *
 * Orchestrates: routing → context → input parsing → pipeline → response encoding.
 * Each concern lives in its own module (codec.ts, input.ts, sse.ts).
 *
 * Analytics / Scalar are NOT here — they wrap the handler externally
 * (see wrapWithAnalytics / wrapWithScalar in their respective modules).
 */

import { createContext, detachContext, releaseContext } from '../compile.ts'
import { compileRouter } from '../compile.ts'

import { detectResponseFormat, encodeResponse, makeErrorResponse } from './codec.ts'
import { applyContext } from './dispatch.ts'
import { parseInput } from './input.ts'
import { routerCache } from './router-utils.ts'
import { iteratorToEventStream } from './sse.ts'
import { parseUrlPath } from './url.ts'

import type { CompiledRoute, CompiledRouterFn } from '../compile.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { ResponseFormat } from './codec.ts'
import type { ContextBridge } from './context-bridge.ts'
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

/**
 * Build the Response for a handler's output. The pooled `ctx` is released
 * by the caller's `using` scope; for streaming outputs we detach `ctx` first
 * so the stream becomes the sole owner (releases on stream end/cancel).
 */
function makeResponse(
  output: unknown,
  route: CompiledRoute,
  format: ResponseFormat,
  ctx: Record<string, unknown>,
): Response | Promise<Response> {
  if (output instanceof Response) {
    return output
  }
  if (output instanceof ReadableStream) {
    detachContext(ctx)
    return new Response(wrapStreamWithRelease(output as ReadableStream<Uint8Array>, ctx), {
      headers: { 'content-type': 'application/octet-stream' },
    })
  }
  if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
    detachContext(ctx)
    const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
    return new Response(wrapStreamWithRelease(stream, ctx), {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  }

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

// ── Fetch Handler ───────────────────────────────────

export type FetchHandler = (request: Request) => Response | Promise<Response>

export interface WrapHandlerOptions {
  analytics?: import('../plugins/analytics/types.ts').AnalyticsOptions
  scalar?: boolean | import('../scalar.ts').ScalarOptions
  /** URL path prefix for the handler (e.g. "/api"). Requests not matching this prefix return 404. */
  basePath?: string
  /**
   * Schema registry for OpenAPI / analytics schema conversion. Built from
   * `schemaConverters` in the silgi instance config — do not set manually.
   * @internal
   */
  schemaRegistry?: import('./schema-converter.ts').SchemaRegistry
  /**
   * Hookable instance — threaded so `wrapWithAnalytics` can register
   * lifecycle listeners on `request:prepare` / `response:finalize`.
   * @internal
   */
  hooks?: Hookable<SilgiHooks>
}

/**
 * Lazily wrap a FetchHandler with analytics and/or scalar.
 * Returns a new handler that applies wrappers on first request (async import).
 * If no wrappers are needed, returns the original handler as-is.
 */
export function wrapHandler(
  handler: FetchHandler,
  router: import('../types.ts').RouterDef,
  options?: WrapHandlerOptions,
  prefix?: string,
): FetchHandler {
  if (!options?.scalar && !options?.analytics) return handler

  let wrapped: FetchHandler | undefined
  let initPromise: Promise<void> | undefined

  async function init(): Promise<void> {
    let h = handler
    if (options!.scalar) {
      const { wrapWithScalar } = await import('../scalar.ts')
      const scalarOpts = typeof options!.scalar === 'object' ? options!.scalar : {}
      h = wrapWithScalar(h, router, scalarOpts, prefix, options!.schemaRegistry)
    }
    if (options!.analytics) {
      const { wrapWithAnalytics } = await import('../plugins/analytics.ts')
      h = wrapWithAnalytics(h, router, options!.analytics, options!.schemaRegistry, options!.hooks)
    }
    wrapped = h
  }

  return (request: Request): Response | Promise<Response> => {
    if (wrapped) return wrapped(request)
    initPromise ??= init()
    return initPromise.then(() => wrapped!(request))
  }
}

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
  prefix?: string,
  bridge?: ContextBridge,
): FetchHandler {
  // Compile router
  let compiledRouter = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  const prefixLen = prefix ? prefix.length : 0
  const jsonHeaders = { 'content-type': 'application/json' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  // Hook helper — fire-and-forget
  function callHook(name: keyof SilgiHooks, event: any): void {
    if (!hooks) return
    try {
      const result = hooks.callHook(name, event)
      if (result instanceof Promise) result.catch(() => {})
    } catch {}
  }

  // Hook helper — awaited (used for critical hooks like `request:prepare`
  // that must complete before the pipeline runs). Sync fast-path when no
  // hooks are registered avoids a per-request Promise allocation.
  function awaitHook(name: keyof SilgiHooks, event: any): void | Promise<void> {
    if (!hooks) return
    try {
      const result = hooks.callHook(name, event)
      if (result instanceof Promise) return result.catch(() => {})
    } catch {}
  }

  // ── Unified Request Handler ───────────────────────

  return async function handleRequest(request: Request): Promise<Response> {
    const url = request.url
    let fullPath = parseUrlPath(url)

    // Strip basePath prefix — zero allocation, pure string slice
    if (prefix) {
      if (!fullPath.startsWith(prefix)) return new Response(notFoundBody, { status: 404, headers: jsonHeaders })
      fullPath = fullPath.slice(prefixLen) || '/'
    }

    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''
    const qMark = url.indexOf('?', url.indexOf('/', url.indexOf('//') + 2))

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
    // Pooled context — `using` releases back to the pool on any exit path
    // (success, throw, early return). Stream responses transfer ownership
    // via detachContext so the stream becomes responsible for release.
    using ctx = createContext()
    let rawInput: unknown

    try {
      // Context
      const baseCtxResult = contextFactory(request)
      const baseCtx = baseCtxResult instanceof Promise ? await baseCtxResult : baseCtxResult
      applyContext(ctx, baseCtx)
      if (match.params) ctx.params = match.params

      // Notify framework plugins (e.g. analytics) that context is ready
      // so they can set `ctx.trace` before any user code runs. Sync result
      // (no hooks, or sync listeners) skips the microtask.
      const prepareResult = awaitHook('request:prepare', { request, ctx })
      if (prepareResult) await prepareResult

      // Input — parse body/query, then merge URL path params
      if (!route.passthrough) rawInput = await parseInput(request, url, qMark)
      if (match.params) {
        rawInput = rawInput != null && typeof rawInput === 'object' ? { ...match.params, ...rawInput } : match.params
      }

      callHook('request', { path: pathname, input: rawInput })

      // Pipeline
      const pipelineResult = bridge
        ? bridge.run(ctx, () => route.handler(ctx, rawInput, request.signal))
        : route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      callHook('response', { path: pathname, output, durationMs: 0 })
      callHook('response:finalize', { request, ctx, output })

      // Response — makeResponse detaches ctx for streaming outputs so the
      // stream wrapper owns release; otherwise `using` releases at scope end.
      const response = makeResponse(output, route, format, ctx)
      return response instanceof Promise ? await response : response
    } catch (error) {
      callHook('error', { path: pathname, error })

      const errorResponse = makeErrorResponse(error, format)
      return errorResponse instanceof Promise ? await errorResponse : errorResponse
    }
  }
}
