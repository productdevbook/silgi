/**
 * Fetch API handler — single unified request handler.
 *
 * Orchestrates: routing → context → input parsing → pipeline → response encoding.
 * Each concern lives in its own module (codec.ts, input.ts, sse.ts).
 *
 * Analytics / Scalar are NOT here — they wrap the handler externally
 * (see wrapWithAnalytics / wrapWithScalar in their respective modules).
 */

import { createContext, releaseContext } from '../compile.ts'
import { compileRouter } from '../compile.ts'
import { analyticsTraceMap } from '../plugins/analytics.ts'

import { detectResponseFormat, encodeResponse, makeErrorResponse } from './codec.ts'
import { applyContext } from './dispatch.ts'
import { parseInput } from './input.ts'
import { routerCache } from './router-utils.ts'
import { iteratorToEventStream } from './sse.ts'

import type { CompiledRoute, CompiledRouterFn } from '../compile.ts'
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

// ── Fetch Handler ───────────────────────────────────

export type FetchHandler = (request: Request) => Response | Promise<Response>

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
): FetchHandler {
  // Compile router
  let compiledRouter = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  const jsonHeaders = { 'content-type': 'application/json' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  // Hook helper
  function callHook(name: keyof SilgiHooks, event: any): void {
    if (!hooks) return
    try {
      const result = hooks.callHook(name, event)
      if (result instanceof Promise) result.catch(() => {})
    } catch {}
  }

  // ── Unified Request Handler ───────────────────────

  return async function handleRequest(request: Request): Promise<Response> {
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

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
    let rawInput: unknown

    try {
      // Context
      const baseCtxResult = contextFactory(request)
      const baseCtx = baseCtxResult instanceof Promise ? await baseCtxResult : baseCtxResult
      applyContext(ctx, baseCtx)
      if (match.params) ctx.params = match.params

      // Inject analytics trace into context (bridges Drizzle/Better Auth tracing)
      const reqTrace = analyticsTraceMap.get(request)
      if (reqTrace) ctx.__analyticsTrace = reqTrace

      // Input
      if (!route.passthrough) rawInput = await parseInput(request, url, qMark)

      callHook('request', { path: pathname, input: rawInput })

      // Pipeline
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      callHook('response', { path: pathname, output, durationMs: 0 })

      // Response — makeResponse handles context release for all paths (including streams)
      const response = makeResponse(output, route, format, ctx)
      return response instanceof Promise ? await response : response
    } catch (error) {
      releaseContext(ctx)
      callHook('error', { path: pathname, error })

      const errorResponse = makeErrorResponse(error, format)
      return errorResponse instanceof Promise ? await errorResponse : errorResponse
    }
  }
}
