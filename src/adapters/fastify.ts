/**
 * Fastify adapter — register silgi router as a Fastify plugin.
 *
 * @example
 * ```ts
 * import Fastify from "fastify"
 * import { silgiFastify } from "silgi/fastify"
 *
 * const app = Fastify()
 * app.register(silgiFastify(appRouter), { prefix: "/rpc" })
 * app.listen({ port: 3000 })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { CompiledRouterFn } from '../compile.ts'
import type { RouterDef } from '../types.ts'

// Lazy-loaded codecs — only resolved when client sends Accept: msgpack/devalue
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

export interface SilgiFastifyOptions {
  /** Context factory — receives Fastify request */
  context?: (req: any) => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * Create a Fastify plugin from a silgi router.
 *
 * Uses a single wildcard route with the compiled radix router for dispatch.
 */
export function silgiFastify(routerDef: RouterDef, options: SilgiFastifyOptions = {}) {
  const compiledRouter: CompiledRouterFn = compileRouter(routerDef)
  const contextFactory = options.context ?? (() => ({}))

  return async function plugin(fastify: any) {
    // Single catch-all route — radix router handles dispatch
    fastify.all('/*', async (req: any, reply: any) => {
      // Use wildcard param — automatically prefix-stripped by Fastify
      const pathname = '/' + (req.params?.['*'] ?? '')
      const method = req.method ?? 'POST'
      const match = compiledRouter(method, pathname)
      if (!match) {
        return reply.status(404).send({ code: 'NOT_FOUND', status: 404, message: 'Not found' })
      }
      const route = match.data

      const ctx: Record<string, unknown> = Object.create(null)
      // Surface URL params from radix router match
      if (match.params) ctx.params = match.params
      try {
        const baseCtx = await contextFactory(req)
        Object.assign(ctx, baseCtx)
      } catch (err) {
        const e = err instanceof SilgiError ? err : toSilgiError(err)
        return reply.status(e.status).send(e.toJSON())
      }

      const rawInput = req.body && typeof req.body === 'object' ? req.body : {}

      try {
        const ac = new AbortController()
        req.raw?.on?.('close', () => ac.abort())
        const result = route.handler(ctx, rawInput, ac.signal)
        const output = result instanceof Promise ? await result : result

        // Cache-Control header for query routes
        if (route.cacheControl) {
          reply.header('cache-control', route.cacheControl)
        }

        // Content negotiation — codecs lazy-loaded on first non-JSON request
        const accept: string | undefined = req.headers.accept
        if (accept?.includes('msgpack')) {
          _msgpack ??= await import('../codec/msgpack.ts')
          return reply
            .header('content-type', _msgpack.MSGPACK_CONTENT_TYPE)
            .send(Buffer.from(_msgpack.encode(output) as ArrayBuffer))
        }
        if (accept?.includes('x-devalue')) {
          _devalue ??= await import('../codec/devalue.ts')
          return reply.header('content-type', _devalue.DEVALUE_CONTENT_TYPE).send(_devalue.encode(output))
        }
        return reply.header('content-type', 'application/json').send(route.stringify(output))
      } catch (error) {
        if (error instanceof ValidationError) {
          return reply.status(400).send({
            code: 'BAD_REQUEST',
            status: 400,
            message: error.message,
            data: { issues: error.issues },
          })
        }
        const e = error instanceof SilgiError ? error : toSilgiError(error)
        return reply.status(e.status).send(e.toJSON())
      }
    })
  }
}
