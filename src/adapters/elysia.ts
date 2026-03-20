/**
 * Elysia adapter — use Katman with Elysia on Bun.
 *
 * @example
 * ```ts
 * import { Elysia } from "elysia"
 * import { katmanElysia } from "katman/elysia"
 *
 * const app = new Elysia()
 *   .use(katmanElysia(appRouter, { prefix: "/rpc" }))
 *   .listen(3000)
 * ```
 */

import { compileRouter } from '../compile.ts'
import { KatmanError, toKatmanError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { RouterDef } from '../types.ts'

export interface ElysiaAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Elysia context */
  context?: (ctx: any) => TCtx | Promise<TCtx>
  /** Route prefix. Default: "/rpc" */
  prefix?: string
}

/**
 * Create an Elysia plugin that routes to Katman procedures.
 *
 * Returns a function that can be passed to `app.use()`.
 */
export function katmanElysia<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: ElysiaAdapterOptions<TCtx> = {},
): (app: any) => any {
  const flatRouter = compileRouter(router)
  const prefix = options.prefix ?? '/rpc'
  return (app: any) => {
    app.all(`${prefix}/*`, async (elysiaCtx: any) => {
      let pathname = new URL(elysiaCtx.request.url).pathname
      if (pathname.startsWith(prefix)) {
        pathname = pathname.slice(prefix.length)
      }
      if (pathname.startsWith('/')) pathname = pathname.slice(1)

      const match = flatRouter(elysiaCtx.request.method, '/' + pathname)
      if (!match) {
        elysiaCtx.set.status = 404
        return { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }
      }
      const route = match.data

      try {
        const ctx: Record<string, unknown> = Object.create(null)
        // Surface URL params from radix router match
        if (match.params) ctx.params = match.params
        if (options.context) {
          const baseCtx = await options.context(elysiaCtx)
          const keys = Object.keys(baseCtx)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
        }

        let input: unknown
        if (elysiaCtx.request.method === 'POST' || elysiaCtx.request.method === 'PUT') {
          input = elysiaCtx.body
        } else {
          const data = elysiaCtx.query?.data
          if (data) input = typeof data === 'string' ? JSON.parse(data) : data
        }

        const signal = elysiaCtx.request.signal ?? new AbortController().signal
        return await route.handler(ctx, input, signal)
      } catch (error) {
        if (error instanceof ValidationError) {
          elysiaCtx.set.status = 400
          return { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
        }
        const e = error instanceof KatmanError ? error : toKatmanError(error)
        elysiaCtx.set.status = e.status
        return e.toJSON()
      }
    })

    return app
  }
}
