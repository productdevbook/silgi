/**
 * Bun adapter — optimized Bun.serve handler for Silgi.
 *
 * Uses Bun-native APIs (request.json(), direct Response) for maximum performance.
 * All hot-path logic is inlined into a single fetch function to minimize
 * function call overhead and maximize JIT optimization.
 *
 * @example
 * ```ts
 * import { silgiBun } from "silgi/bun"
 *
 * Bun.serve(silgiBun(appRouter, { context: () => ({ db }) }))
 * ```
 */

import { compileRouter } from '../compile.ts'
import { SilgiError, toSilgiError } from '../core/error.ts'
import { routerCache } from '../core/router-utils.ts'
import { ValidationError } from '../core/schema.ts'
import { iteratorToEventStream } from '../core/sse.ts'

import type { RouterDef } from '../types.ts'

export interface BunAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Request */
  context?: (req: Request) => TCtx | Promise<TCtx>
  /** Port. Default: 3000 */
  port?: number
  /** Hostname. Default: "0.0.0.0" */
  hostname?: string
}

/**
 * Create a Bun.serve() config with optimized Silgi handler.
 */
export function silgiBun<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: BunAdapterOptions<TCtx> = {},
): { port: number; hostname: string; fetch: (request: Request) => Response | Promise<Response> } {
  // Compile router
  let compiled = routerCache.get(router)
  if (!compiled) {
    compiled = compileRouter(router)
    routerCache.set(router, compiled)
  }
  const lookup = compiled

  // Context — detect sync/empty at init time
  const ctxFactory = options.context
  let ctxIsSync = true
  let ctxIsEmpty = !ctxFactory
  if (ctxFactory) {
    try {
      const test = ctxFactory(new Request('http://localhost'))
      if (test instanceof Promise) {
        ctxIsSync = false
        test.then((r) => {
          ctxIsEmpty = Object.keys(r).length === 0
        })
      } else {
        ctxIsEmpty = Object.keys(test).length === 0
      }
    } catch {}
  }

  // Pre-allocated constants
  const JSON_HDR = { 'content-type': 'application/json' }
  const SSE_HDR = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
  const STREAM_HDR = { 'content-type': 'application/octet-stream' }
  const NOT_FOUND = '{"code":"NOT_FOUND","status":404,"message":"Procedure not found"}'

  // Inline error handler — no function call overhead
  function _err(error: unknown): Response {
    if (error instanceof ValidationError) {
      return new Response(
        JSON.stringify({ code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }),
        { status: 400, headers: JSON_HDR },
      )
    }
    const e = error instanceof SilgiError ? error : toSilgiError(error)
    return new Response(JSON.stringify(e.toJSON()), { status: e.status, headers: JSON_HDR })
  }

  // Single monolithic fetch — everything inlined for JIT
  function fetch(request: Request): Response | Promise<Response> {
    // URL parse
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)

    // Route lookup
    const match = lookup(request.method, fullPath)
    if (!match) return new Response(NOT_FOUND, { status: 404, headers: JSON_HDR })

    const route = match.data
    const handler = route.handler
    const stringify = route.stringify
    // Response.json() is Bun-native C++ — faster than new Response(JSON.stringify(...))
    // Only safe when no custom fast-stringify is compiled (i.e. no output schema)
    const nativeJson = stringify === JSON.stringify

    // ── GET or no body — sync only when context factory is sync ──
    if (ctxIsSync && (request.method === 'GET' || !request.body)) {
      const ctx: Record<string, unknown> = Object.create(null)
      try {
        if (!ctxIsEmpty && ctxFactory) {
          const base = ctxFactory(request) as Record<string, unknown>
          const keys = Object.keys(base)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = base[keys[i]!]
        }
        if (match.params) ctx.params = match.params

        let input: unknown
        if (qMark !== -1) {
          const s = url.slice(qMark + 1)
          const di = s.indexOf('data=')
          if (di !== -1) {
            const vs = di + 5
            const ve = s.indexOf('&', vs)
            input = JSON.parse(decodeURIComponent(ve === -1 ? s.slice(vs) : s.slice(vs, ve)))
          }
        }

        const result = handler(ctx, input, request.signal)

        if (!(result instanceof Promise)) {
          // Fully sync — fastest path
          if (result instanceof Response) return result
          return nativeJson ? Response.json(result) : new Response(stringify(result), { headers: JSON_HDR })
        }

        return result.then((output) => {
          if (output instanceof Response) return output
          if (output instanceof ReadableStream) return new Response(output, { headers: STREAM_HDR })
          if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object))
            return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: SSE_HDR })
          return nativeJson ? Response.json(output) : new Response(stringify(output), { headers: JSON_HDR })
        }, _err)
      } catch (error) {
        return _err(error)
      }
    }

    // ── POST with body — async/await (JSC optimizes await better than .then) ──
    return _post(request, match, handler, nativeJson, stringify)
  }

  async function _post(
    request: Request,
    match: { params?: Record<string, string> },
    handler: (ctx: Record<string, unknown>, input: unknown, signal: AbortSignal) => unknown,
    nativeJson: boolean,
    stringify: (v: unknown) => string,
  ): Promise<Response> {
    const ctx: Record<string, unknown> = Object.create(null)
    try {
      if (!ctxIsEmpty && ctxFactory) {
        const baseResult = ctxFactory(request)
        const base = baseResult instanceof Promise ? await baseResult : baseResult
        const keys = Object.keys(base)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = (base as any)[keys[i]!]
      }
      if (match.params) ctx.params = match.params

      const input = await request.json()
      const result = handler(ctx, input, request.signal)
      const output = result instanceof Promise ? await result : result

      if (output instanceof Response) return output
      if (output instanceof ReadableStream) return new Response(output, { headers: STREAM_HDR })
      if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object))
        return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: SSE_HDR })
      return nativeJson ? Response.json(output) : new Response(stringify(output), { headers: JSON_HDR })
    } catch (error) {
      return _err(error)
    }
  }

  return {
    port: options.port ?? 3000,
    hostname: options.hostname ?? '0.0.0.0',
    fetch,
  }
}
