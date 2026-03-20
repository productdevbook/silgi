/**
 * Nitro v3 adapter — use Silgi with Nitro server routes.
 *
 * Nitro v3 uses H3 v2 under the hood with `defineHandler` from `nitro/h3`.
 * This adapter creates a catch-all route handler that dispatches to
 * Silgi procedures.
 *
 * ## File-system routing
 *
 * Create a catch-all route at `server/routes/rpc/[...path].ts`:
 *
 * ```ts
 * import { silgiNitro } from "silgi/nitro"
 * import { appRouter } from "~/server/rpc"
 *
 * export default silgiNitro(appRouter, {
 *   context: (event) => ({
 *     db: getDB(),
 *     user: event.context.auth,
 *   }),
 * })
 * ```
 *
 * This handles all requests under `/rpc/*`:
 * - `POST /rpc/users/list` → calls `users.list`
 * - `GET /rpc/users/get?data={"id":1}` → calls `users.get`
 *
 * ## With explicit prefix
 *
 * If you prefer a single entry handler instead of FS routing:
 *
 * ```ts
 * // server/routes/[...].ts (catch-all)
 * import { silgiNitro } from "silgi/nitro"
 *
 * export default silgiNitro(appRouter, {
 *   prefix: "/rpc",
 *   context: (event) => ({ db: getDB() }),
 * })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { RouterDef } from '../types.ts'

export interface NitroAdapterOptions<TCtx extends Record<string, unknown>> {
  /**
   * Context factory — receives the Nitro/H3 event.
   * Access `event.context` for middleware data (auth, session, etc.).
   */
  context?: (event: NitroEvent) => TCtx | Promise<TCtx>
  /**
   * Route prefix to strip from the path.
   * When using FS routing at `server/routes/rpc/[...path].ts`,
   * leave this undefined — the path param is used directly.
   * When using a catch-all handler, set this to strip the prefix.
   */
  prefix?: string
}

/** Minimal Nitro/H3 v2 event shape */
interface NitroEvent {
  url: URL
  path: string
  req: {
    method: string
    headers: Headers
    json(): Promise<unknown>
    text(): Promise<string>
  }
  res: {
    headers: Headers
  }
  context: {
    params: Record<string, string>
    [key: string]: unknown
  }
}

/**
 * Create a Nitro v3 handler that dispatches to Silgi procedures.
 *
 * Returns a function compatible with `defineHandler` from `nitro/h3`.
 * Nitro auto-serializes the return value as JSON.
 */
export function silgiNitro<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: NitroAdapterOptions<TCtx> = {},
): (event: NitroEvent) => Promise<unknown> {
  const flatRouter = compileRouter(router)
  const prefix = options.prefix
  return async (event: NitroEvent) => {
    // Resolve procedure path
    let procedurePath: string

    // Option 1: FS routing — path comes from [...path] param
    const pathParam = event.context.params?.path
    if (pathParam && !prefix) {
      // Nitro joins catch-all segments with "/"
      procedurePath = pathParam
    } else {
      // Option 2: Explicit prefix — strip from event.path
      const rawPath = event.path ?? event.url?.pathname ?? '/'
      procedurePath = prefix ? stripPrefix(rawPath, prefix) : stripLeadingSlash(rawPath)
    }

    const match = flatRouter(event.req.method, '/' + procedurePath)
    if (!match) {
      return {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Procedure not found',
      }
    }
    const route = match.data

    try {
      // Build context
      const ctx: Record<string, unknown> = Object.create(null)
      // Surface URL params from radix router match
      if (match.params) ctx.params = match.params
      if (options.context) {
        const baseCtx = await options.context(event)
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }

      // Parse input
      let input: unknown
      const method = event.req.method

      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        // Nitro v3 / H3 v2: event.req.json()
        input = await event.req.json().catch(() => undefined)
      } else {
        // GET: check searchParams
        const data = event.url.searchParams.get('data')
        if (data) input = JSON.parse(data)
      }

      // Execute compiled pipeline
      const signal = (event.req as any)?.signal ?? new AbortController().signal
      const output = await route.handler(ctx, input, signal)
      return output
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          code: 'BAD_REQUEST',
          status: 400,
          message: error.message,
          data: { issues: error.issues },
        }
      }
      const e = error instanceof SilgiError ? error : toSilgiError(error)
      return e.toJSON()
    }
  }
}

function stripPrefix(path: string, prefix: string): string {
  const clean = path.startsWith(prefix) ? path.slice(prefix.length) : path
  return clean.startsWith('/') ? clean.slice(1) : clean
}

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}
