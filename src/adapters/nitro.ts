/**
 * Nitro v3 adapter — use Silgi with Nitro server routes.
 *
 * Nitro v3 uses H3 v2 under the hood with `defineHandler` from `nitro/h3`.
 *
 * ## File-system routing
 *
 * Create a catch-all route at `server/routes/rpc/[...path].ts`:
 *
 * ```ts
 * import { defineHandler } from "nitro/h3"
 * import { compileRouter } from "silgi/compile"
 * import { appRouter } from "~/server/rpc"
 *
 * const compiledRouter = compileRouter(appRouter)
 *
 * export default defineHandler(async (event) => {
 *   const path = event.context.params?.path || ""
 *   const match = compiledRouter(event.method, "/" + path)
 *   if (!match) return { code: "NOT_FOUND", status: 404 }
 *
 *   const input = event.method === "POST"
 *     ? await event.req.json().catch(() => undefined)
 *     : undefined
 *
 *   return await match.data.handler({}, input, new AbortController().signal)
 * })
 * ```
 *
 * For full context + error handling, use the `silgiNitro` helper below.
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
   */
  prefix?: string
}

/** Nitro v3 / H3 v2 event shape */
interface NitroEvent {
  method: string
  path: string
  url: URL
  req: {
    json(): Promise<unknown>
    text(): Promise<string>
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
    let procedurePath: string

    // FS routing: path comes from [...path] param
    const pathParam = event.context.params?.path
    if (pathParam && !prefix) {
      procedurePath = pathParam
    } else {
      // Explicit prefix: strip from event.path
      const rawPath = event.path ?? event.url?.pathname ?? '/'
      procedurePath = prefix ? stripPrefix(rawPath, prefix) : stripLeadingSlash(rawPath)
    }

    const method = event.method
    const match = flatRouter(method, '/' + procedurePath)
    if (!match) {
      return { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }
    }
    const route = match.data

    try {
      const ctx: Record<string, unknown> = Object.create(null)
      if (match.params) ctx.params = match.params
      if (options.context) {
        const baseCtx = await options.context(event)
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }

      let input: unknown
      if (method === 'POST' || method === 'PUT' || method === 'PATCH') {
        input = await event.req.json().catch(() => undefined)
      } else {
        const data = event.url.searchParams.get('data')
        if (data) input = JSON.parse(data)
      }

      const signal = new AbortController().signal
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

function stripPrefix(path: string, prefix: string): string {
  const clean = path.startsWith(prefix) ? path.slice(prefix.length) : path
  return clean.startsWith('/') ? clean.slice(1) : clean
}

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}
