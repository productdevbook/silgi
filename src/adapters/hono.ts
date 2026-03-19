/**
 * Hono adapter — use Katman with Hono on any runtime.
 *
 * @example
 * ```ts
 * import { Hono } from "hono"
 * import { katmanHono } from "katman/hono"
 *
 * const app = new Hono()
 * app.all("/rpc/*", katmanHono(appRouter, {
 *   context: (c) => ({ db: getDB(), user: c.get("user") }),
 * }))
 * ```
 */

import { compileRouter } from '../compile.ts'
import { KatmanError, toKatmanError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { RouterDef } from '../types.ts'

export interface HonoAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Hono context */
  context?: (c: any) => TCtx | Promise<TCtx>
  /** Route prefix to strip. Default: "/rpc" */
  prefix?: string
}

/**
 * Create a Hono handler that routes to Katman procedures.
 *
 * Works with Hono on Node.js, Bun, Deno, Cloudflare Workers, etc.
 */
export function katmanHono<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: HonoAdapterOptions<TCtx> = {},
): (c: any) => Promise<Response> {
  const flatRouter = compileRouter(router)
  const prefix = options.prefix ?? '/rpc'
  return async (c: any) => {
    const url = new URL(c.req.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
    }
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    const route = flatRouter('POST', '/' + pathname)?.data
    if (!route) {
      return c.json({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }, 404)
    }

    try {
      const ctx: Record<string, unknown> = Object.create(null)
      if (options.context) {
        const baseCtx = await options.context(c)
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }

      let input: unknown
      if (c.req.method === 'POST' || c.req.method === 'PUT' || c.req.method === 'PATCH') {
        input = await c.req.json().catch(() => undefined)
      } else {
        const data = c.req.query('data')
        if (data) {
          try {
            input = JSON.parse(data)
          } catch {
            return c.json({ code: 'BAD_REQUEST', status: 400, message: 'Invalid JSON in data parameter' }, 400)
          }
        }
      }

      const signal = c.req.raw?.signal ?? new AbortController().signal
      const output = await route.handler(ctx, input, signal)
      return c.json(output)
    } catch (error) {
      if (error instanceof ValidationError) {
        return c.json({ code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }, 400)
      }
      const e = error instanceof KatmanError ? error : toKatmanError(error)
      return c.json(e.toJSON(), e.status)
    }
  }
}
