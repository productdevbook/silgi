/**
 * H3 v2 adapter — use Silgi with Nitro, Nuxt, or any H3 server.
 *
 * @example
 * ```ts
 * import { H3 } from "h3"
 * import { silgiH3 } from "silgi/h3"
 *
 * const app = new H3()
 * app.all("/rpc/**", silgiH3(appRouter, {
 *   context: (event) => ({ db: getDB(), user: event.context.user }),
 * }))
 * ```
 */

import { compileRouter } from '../compile.ts'
import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { RouterDef } from '../types.ts'

export interface H3AdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the H3 event */
  context?: (event: any) => TCtx | Promise<TCtx>
  /**
   * Route prefix to strip from the path.
   * When using Nitro FS routing ([...path].ts), leave undefined — path comes from params.
   * When using H3 catch-all, set to strip prefix (e.g., "/rpc").
   */
  prefix?: string
}

/**
 * Create an H3 v2 handler that routes to Silgi procedures.
 *
 * H3 v2 uses `new H3()`, `defineHandler`, `event.req.json()`, etc.
 * Works with H3 v2, Nitro v3, and Nuxt 4.
 */
export function silgiH3<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: H3AdapterOptions<TCtx> = {},
): (event: any) => Promise<unknown> {
  const flatRouter = compileRouter(router)
  const prefix = options.prefix ?? '/rpc'
  return async (event: any) => {
    // Nitro FS routing: [...path].ts provides path via event.context.params.path
    const url = event.url ?? new URL(event.req?.url ?? '/', 'http://localhost')
    const catchAllPath = event.context?.params?.path
    const pathname = catchAllPath ? catchAllPath : extractPath(typeof url === 'string' ? url : url.pathname, prefix)

    const httpMethod = event.req?.method ?? event.method ?? 'POST'
    const match = flatRouter(httpMethod, '/' + pathname)
    if (!match) {
      // H3 v2: set status via event.res.headers or return with status
      if (event.res?.headers) event.res.headers.set('content-type', 'application/json')
      return { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }
    }
    const route = match.data

    try {
      const ctx: Record<string, unknown> = Object.create(null)
      // Surface URL params from radix router match
      if (match.params) ctx.params = match.params
      if (options.context) {
        const baseCtx = await options.context(event)
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }

      // Parse input — H3 v2 uses event.req.json() / event.url.searchParams
      let input: unknown
      const method = event.req?.method ?? event.method ?? 'GET'
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // H3 v2: event.req is Request-like with .json()
        if (typeof event.req?.json === 'function') {
          input = await event.req.json().catch(() => undefined)
        } else {
          // Fallback: try readBody from h3
          try {
            const { readBody } = await import('h3')
            input = await readBody(event)
          } catch {
            /* ignore */
          }
        }
      } else {
        // GET: check searchParams
        const searchParams = url.searchParams ?? new URLSearchParams()
        const data = searchParams.get('data')
        if (data) {
          try {
            input = JSON.parse(data)
          } catch {
            return { code: 'BAD_REQUEST', status: 400, message: 'Invalid JSON in data parameter' }
          }
        }
      }

      const signal = event.req?.signal ?? new AbortController().signal
      const output = await route.handler(ctx, input, signal)
      return output
    } catch (error) {
      if (error instanceof ValidationError) {
        return { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
      }
      const e = error instanceof SilgiError ? error : toSilgiError(error)
      return e.toJSON()
    }
  }
}

function extractPath(pathname: string, prefix: string): string {
  const qIdx = pathname.indexOf('?')
  const clean = qIdx === -1 ? pathname : pathname.slice(0, qIdx)
  if (clean.startsWith(prefix)) {
    const rest = clean.slice(prefix.length)
    return rest.startsWith('/') ? rest.slice(1) : rest
  }
  return clean.startsWith('/') ? clean.slice(1) : clean
}
