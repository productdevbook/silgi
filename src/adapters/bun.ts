/**
 * Bun adapter — optimized Bun.serve handler for Silgi.
 *
 * @example
 * ```ts
 * import { silgiBun } from "silgi/bun"
 *
 * Bun.serve(silgiBun(appRouter, { context: () => ({ db }) }))
 * ```
 */

import { compileRouter } from '../compile.ts'
import { buildContext, isMethodAllowed, serializeError, parseQueryData } from '../core/dispatch.ts'
import { routerCache } from '../core/router-utils.ts'
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
  let compiled = routerCache.get(router)
  if (!compiled) {
    compiled = compileRouter(router)
    routerCache.set(router, compiled)
  }
  const lookup = compiled
  const ctxFactory = options.context

  const JSON_HDR = { 'content-type': 'application/json' }
  const SSE_HDR = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
  const STREAM_HDR = { 'content-type': 'application/octet-stream' }
  const NOT_FOUND = '{"code":"NOT_FOUND","status":404,"message":"Procedure not found"}'

  function makeResponse(output: unknown): Response {
    if (output instanceof Response) return output
    if (output instanceof ReadableStream) return new Response(output, { headers: STREAM_HDR })
    if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
      return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: SSE_HDR })
    }
    return Response.json(output)
  }

  async function fetch(request: Request): Promise<Response> {
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)

    const match = lookup(request.method, fullPath)
    if (!match) return new Response(NOT_FOUND, { status: 404, headers: JSON_HDR })

    const route = match.data
    const reqMethod = request.method

    if (!isMethodAllowed(reqMethod, route.method)) {
      return new Response(
        JSON.stringify({ code: 'METHOD_NOT_ALLOWED', status: 405, message: `Method ${reqMethod} not allowed` }),
        { status: 405, headers: { ...JSON_HDR, allow: route.method } },
      )
    }

    try {
      // Build context
      const baseCtx = ctxFactory ? await ctxFactory(request) : undefined
      const ctx = buildContext(baseCtx as Record<string, unknown> | undefined, match.params)

      // Parse input
      let input: unknown
      if (reqMethod === 'GET' || !request.body) {
        if (qMark !== -1) {
          const s = url.slice(qMark + 1)
          const di = s.indexOf('data=')
          if (di !== -1) {
            const vs = di + 5
            const ve = s.indexOf('&', vs)
            input = parseQueryData(ve === -1 ? s.slice(vs) : s.slice(vs, ve))
          }
        }
      } else {
        try {
          input = await request.json()
        } catch {
          input = undefined
        }
      }

      // Execute pipeline
      const result = route.handler(ctx, input, request.signal)
      const output = result instanceof Promise ? await result : result
      return makeResponse(output)
    } catch (error) {
      const body = serializeError(error)
      return new Response(JSON.stringify(body), { status: body.status, headers: JSON_HDR })
    }
  }

  return {
    port: options.port ?? 3000,
    hostname: options.hostname ?? '0.0.0.0',
    fetch,
  }
}
