/**
 * Server-side batch endpoint — handle multiple RPC calls in one HTTP request.
 *
 * Works with the client-side BatchLink to combine multiple calls into
 * a single HTTP round-trip.
 *
 * @example
 * ```ts
 * import { createBatchHandler } from "silgi/plugins"
 *
 * const batchHandler = createBatchHandler(appRouter, {
 *   context: (req) => ({ db: getDB() }),
 *   maxBatchSize: 20,
 * })
 *
 * // Mount at /batch endpoint alongside your normal handler
 * ```
 */

import { compileRouter } from '../compile.ts'
import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { RouterDef } from '../types.ts'

export interface BatchHandlerOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — called once per batch request */
  context: (req: Request) => TCtx | Promise<TCtx>
  /** Maximum number of calls in a single batch. Default: 50 */
  maxBatchSize?: number
}

interface BatchRequest {
  path: string
  input?: unknown
}

interface BatchResponse {
  data?: unknown
  error?: { code: string; status: number; message: string; data?: unknown }
}

/**
 * Create a Fetch API handler that processes batched RPC calls.
 *
 * Expects a POST with JSON body: `[{ path, input }, ...]`
 * Returns: `[{ data } | { error }, ...]`
 *
 * All calls in a batch share the same context (computed once).
 */
export function createBatchHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: BatchHandlerOptions<TCtx>,
): (request: Request) => Promise<Response> {
  const flatRouter = compileRouter(router)
  const { maxBatchSize = 50 } = options

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') {
      return Response.json({ code: 'METHOD_NOT_ALLOWED', status: 405 }, { status: 405 })
    }

    let calls: BatchRequest[]
    try {
      calls = await request.json()
    } catch {
      return Response.json({ code: 'BAD_REQUEST', status: 400, message: 'Invalid JSON' }, { status: 400 })
    }

    if (!Array.isArray(calls)) {
      return Response.json({ code: 'BAD_REQUEST', status: 400, message: 'Expected array' }, { status: 400 })
    }

    if (calls.length > maxBatchSize) {
      return Response.json(
        {
          code: 'BAD_REQUEST',
          status: 400,
          message: `Batch too large: ${calls.length} calls (max ${maxBatchSize})`,
        },
        { status: 400 },
      )
    }

    // Build context once for the entire batch
    const baseCtx = await options.context(request)

    // Execute all calls concurrently
    const results = await Promise.all(
      calls.map(async (call): Promise<BatchResponse> => {
        const route = flatRouter('POST', '/' + call.path)?.data
        if (!route) {
          return { error: { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' } }
        }

        try {
          const ctx: Record<string, unknown> = Object.create(null)
          const keys = Object.keys(baseCtx)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]

          const output = await route.handler(ctx, call.input, request.signal)
          return { data: output }
        } catch (error) {
          if (error instanceof ValidationError) {
            return {
              error: { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } },
            }
          }
          const e = error instanceof SilgiError ? error : toSilgiError(error)
          return { error: e.toJSON() as any }
        }
      }),
    )

    return Response.json(results)
  }
}
