/**
 * Express adapter — use Silgi as Express middleware.
 *
 * @example
 * ```ts
 * import express from "express"
 * import { createHandler } from "silgi/express"
 *
 * const app = express()
 * app.use("/api", createHandler(appRouter, {
 *   context: (req) => ({ db: getDB(), user: req.user }),
 * }))
 * app.listen(3000)
 * ```
 */

import { compileRouter } from '../compile.ts'
import { buildContext, isMethodAllowed, parseQueryData, serializeError } from '../core/dispatch.ts'
import { iteratorToEventStream } from '../core/sse.ts'

import type { RouterDef } from '../types.ts'

export interface ExpressAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Express request */
  context?: (req: any) => TCtx | Promise<TCtx>
}

/**
 * Create Express middleware that routes to Silgi procedures.
 *
 * Mount at a prefix — the remainder of the path is the procedure name.
 * Requires `express.json()` middleware for POST body parsing.
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: ExpressAdapterOptions<TCtx> = {},
): (req: any, res: any, next: any) => void {
  const flatRouter = compileRouter(router)
  return (req: any, res: any, next: any) => {
    // Strip leading slash from the path after the mount prefix
    let pathname = req.path ?? req.url ?? ''
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    const match = flatRouter(req.method, '/' + pathname)
    if (!match) {
      // Pass to next middleware if not found
      return next()
    }
    const route = match.data

    // HTTP method enforcement
    if (!isMethodAllowed(req.method, route.method)) {
      res
        .status(405)
        .set('allow', route.method)
        .json({
          code: 'METHOD_NOT_ALLOWED',
          status: 405,
          message: `Method ${req.method} not allowed`,
        })
      return
    }

    const handle = async () => {
      try {
        const baseCtx = options.context ? await options.context(req) : undefined
        const ctx = buildContext(baseCtx as Record<string, unknown> | undefined, match.params)

        // Input from body (POST) or query string (GET)
        let input: unknown
        if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
          input = req.body
        } else if (req.query?.data) {
          input = typeof req.query.data === 'string' ? parseQueryData(req.query.data) : req.query.data
        }

        const ac = new AbortController()
        const onClose = () => ac.abort()
        req.on('close', onClose)
        try {
          const output = await route.handler(ctx, input, ac.signal)

          // Handle Response, ReadableStream, and AsyncIterator outputs
          if (output instanceof Response) {
            res.status(output.status)
            output.headers.forEach((v: string, k: string) => res.setHeader(k, v))
            const body = output.body ? Buffer.from(await output.arrayBuffer()) : ''
            res.end(body)
          } else if (output instanceof ReadableStream) {
            res.setHeader('content-type', 'application/octet-stream')
            const reader = (output as ReadableStream<Uint8Array>).getReader()
            // Cancel reader on client disconnect to prevent resource leaks
            req.on('close', () => reader.cancel())
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  res.end()
                  break
                }
                res.write(value)
              }
            } finally {
              reader.releaseLock()
            }
          } else if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
            const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
            res.setHeader('content-type', 'text/event-stream')
            res.setHeader('cache-control', 'no-cache')
            const reader = stream.getReader()
            // Cancel reader on client disconnect to release pubsub subscriptions
            req.on('close', () => reader.cancel())
            try {
              while (true) {
                const { done, value } = await reader.read()
                if (done) {
                  res.end()
                  break
                }
                res.write(value)
              }
            } finally {
              reader.releaseLock()
            }
          } else {
            res.json(output)
          }
        } finally {
          req.removeListener('close', onClose)
        }
      } catch (error) {
        const body = serializeError(error)
        res.status(body.status).json(body)
      }
    }

    handle().catch((error) => {
      // Prevent unhandled promise rejection — send 500 if response not yet sent
      if (!res.headersSent) {
        const body = serializeError(error)
        res.status(body.status).json(body)
      }
    })
  }
}
