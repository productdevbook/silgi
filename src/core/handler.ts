/**
 * Fetch API handler
 * -------------------
 *
 * Every adapter that speaks the Fetch API (Next.js App Router, SvelteKit,
 * srvx, Bun, Cloudflare Workers, Deno) ends up calling the handler built
 * here. It is the single place that turns a `Request` into a `Response`
 * by running the compiled pipeline produced by `compileRouter`.
 *
 * Responsibilities, in order:
 *
 *   1. URL parsing and `basePath` stripping.
 *   2. Route lookup + HTTP method enforcement.
 *   3. Context construction (factory + optional `AsyncLocalStorage` bridge).
 *   4. `request:prepare` hook so plugins (analytics, etc.) can seed `ctx`.
 *   5. Input parsing (body / query / URL params).
 *   6. Pipeline execution — the compiled handler from `compileProcedure`.
 *   7. Response encoding (JSON, msgpack, stream, SSE, raw `Response`).
 *
 * Analytics and the Scalar UI are layered on top via `wrapHandler` — they
 * do not live inside the hot path.
 */

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

// Re-exports kept for external callers that imported these from handler.ts.
export type { ResponseFormat } from './codec.ts'
export { encodeResponse } from './codec.ts'

// ─── Response builder ─────────────────────────────────────────────────

/**
 * Convert a pipeline output into an HTTP `Response`.
 *
 * We handle four shapes:
 *   - `Response` — user returned one directly; pass through.
 *   - `ReadableStream` — wrap in a binary response.
 *   - Async iterator — render as Server-Sent Events.
 *   - Plain value — encode as JSON (or msgpack when the client asked for it).
 *
 * The function is async so callers have a single `await` point and do not
 * have to branch on sync-vs-async encoders underneath.
 */
async function makeResponse(output: unknown, route: CompiledRoute, format: ResponseFormat): Promise<Response> {
  if (output instanceof Response) return output

  if (output instanceof ReadableStream) {
    return new Response(output, {
      headers: { 'content-type': 'application/octet-stream' },
    })
  }

  if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
    const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
    return new Response(stream, {
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

// ─── Public types ─────────────────────────────────────────────────────

export type FetchHandler = (request: Request) => Response | Promise<Response>

export interface WrapHandlerOptions {
  analytics?: import('../plugins/analytics/types.ts').AnalyticsOptions
  scalar?: boolean | import('../scalar.ts').ScalarOptions
  /** URL path prefix for the handler (e.g. `/api`). Requests outside the prefix return 404. */
  basePath?: string
  /**
   * Schema registry for OpenAPI / analytics schema conversion. Built from
   * `schemaConverters` in the silgi instance config — do not set manually.
   * @internal
   */
  schemaRegistry?: import('./schema-converter.ts').SchemaRegistry
  /**
   * Hookable instance threaded through so `wrapWithAnalytics` can register
   * listeners on `request:prepare` / `response:finalize`.
   * @internal
   */
  hooks?: Hookable<SilgiHooks>
}

// ─── Lazy wrapper composition (scalar / analytics) ────────────────────

/**
 * Wrap a `FetchHandler` with Scalar UI and/or analytics, if configured.
 *
 * Both wrappers have non-trivial imports (Scalar pulls in the API
 * reference, analytics pulls in the dashboard). We defer those imports
 * until the first request so that a handler you never hit does not pay
 * the cost.
 *
 * If the lazy init fails (network blip, broken import) we fall back to
 * the raw handler and log once — one failed init must not wedge every
 * subsequent request.
 */
export function wrapHandler(
  handler: FetchHandler,
  router: import('../types.ts').RouterDef,
  options?: WrapHandlerOptions,
  prefix?: string,
): FetchHandler {
  if (!options?.scalar && !options?.analytics) return handler

  let wrapped: FetchHandler = handler
  let initDone = false
  let initPromise: Promise<void> | undefined

  const init = async (): Promise<void> => {
    try {
      let next = handler
      if (options.scalar) {
        const { wrapWithScalar } = await import('../scalar.ts')
        const scalarOpts = typeof options.scalar === 'object' ? options.scalar : {}
        next = wrapWithScalar(next, router, scalarOpts, prefix, options.schemaRegistry)
      }
      if (options.analytics) {
        const { wrapWithAnalytics } = await import('../plugins/analytics.ts')
        next = wrapWithAnalytics(next, router, options.analytics, options.schemaRegistry, options.hooks)
      }
      wrapped = next
    } catch (err) {
      console.error('[silgi] Failed to initialise scalar/analytics wrapper:', err)
      wrapped = handler
    } finally {
      initDone = true
    }
  }

  return (request) => {
    if (initDone) return wrapped(request)
    initPromise ??= init()
    return initPromise.then(() => wrapped(request))
  }
}

// ─── Main handler factory ─────────────────────────────────────────────

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
  prefix?: string,
  bridge?: ContextBridge,
): FetchHandler {
  // Router compilation is keyed off the user's def via a `WeakMap` so two
  // adapters sharing the same def also share the compiled router.
  let compiledRouter = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  const prefixLen = prefix ? prefix.length : 0
  const jsonHeaders = { 'content-type': 'application/json' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  /**
   * Hook dispatch helpers.
   *
   * Hook errors never fail the request. But we do log them: silently
   * swallowing a hook throw hides genuine user bugs (a typo'd field, a
   * thrown assertion) and the dashboard / trace / logging pipeline just
   * stops working with no visible signal.
   */
  const reportHookError = (name: string, err: unknown): void => {
    console.error(`[silgi] hook "${name}" threw:`, err)
  }

  const callHook = (name: keyof SilgiHooks, event: unknown): void => {
    if (!hooks) return
    try {
      const result = hooks.callHook(name, event as never)
      if (result instanceof Promise) result.catch((err) => reportHookError(name, err))
    } catch (err) {
      reportHookError(name, err)
    }
  }

  const awaitHook = async (name: keyof SilgiHooks, event: unknown): Promise<void> => {
    if (!hooks) return
    try {
      await hooks.callHook(name, event as never)
    } catch (err) {
      reportHookError(name, err)
    }
  }

  // ─── Request handler ───────────────────────────────────────────────

  return async function handleRequest(request: Request): Promise<Response> {
    const url = request.url
    let fullPath = parseUrlPath(url)

    // `basePath` stripping. We require a segment boundary so that
    // `prefix = '/api'` never matches `/api2/...`.
    if (prefix) {
      if (fullPath !== prefix && !fullPath.startsWith(prefix + '/')) {
        return new Response(notFoundBody, { status: 404, headers: jsonHeaders })
      }
      fullPath = fullPath.slice(prefixLen) || '/'
    }

    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''
    const qMark = url.indexOf('?', url.indexOf('/', url.indexOf('//') + 2))

    const match = compiledRouter!(request.method, fullPath)
    if (!match) return new Response(notFoundBody, { status: 404, headers: jsonHeaders })

    const route = match.data
    const reqMethod = request.method

    // HTTP method enforcement. `GET` against a `POST` route is allowed so
    // that clients can read the procedure via a query string; `OPTIONS`
    // is always allowed so that CORS preflights succeed.
    if (route.method !== '*' && reqMethod !== route.method && reqMethod !== 'OPTIONS') {
      if (!(reqMethod === 'GET' && route.method === 'POST')) {
        return new Response(
          JSON.stringify({ code: 'METHOD_NOT_ALLOWED', status: 405, message: `Method ${reqMethod} not allowed` }),
          { status: 405, headers: { ...jsonHeaders, allow: route.method } },
        )
      }
    }

    const format = detectResponseFormat(request)

    // Per-request context. We use a null-prototype object so user-supplied
    // keys cannot accidentally shadow `Object.prototype` members and so
    // property lookups stay on the object itself.
    const ctx = Object.create(null) as Record<string, unknown>
    let rawInput: unknown

    try {
      const baseCtx = await contextFactory(request)
      applyContext(ctx, baseCtx)
      if (match.params) ctx.params = match.params

      // `request:prepare` runs before any user code — framework plugins
      // (e.g. analytics) rely on it to seed `ctx.trace`. It is awaited
      // because the plugin's work must land on `ctx` before the pipeline
      // reads it.
      await awaitHook('request:prepare', { request, ctx })

      // Input comes from the body (or query string for GETs), then URL
      // path params are merged on top so named routes can use `{ id }`.
      if (!route.passthrough) rawInput = await parseInput(request, url, qMark)
      if (match.params) {
        rawInput = rawInput != null && typeof rawInput === 'object' ? { ...match.params, ...rawInput } : match.params
      }

      callHook('request', { path: pathname, input: rawInput })

      // Pipeline execution. `bridge.run` installs `ctx` into this silgi
      // instance's `AsyncLocalStorage` so that instrumented integrations
      // (Drizzle, Better Auth) can read it from anywhere inside the
      // resolver call tree.
      const output = await (bridge
        ? bridge.run(ctx, () => route.handler(ctx, rawInput, request.signal))
        : route.handler(ctx, rawInput, request.signal))

      callHook('response', { path: pathname, output, durationMs: 0 })
      callHook('response:finalize', { request, ctx, output })

      return await makeResponse(output, route, format)
    } catch (error) {
      callHook('error', { path: pathname, error })
      return await makeErrorResponse(error, format)
    }
  }
}
