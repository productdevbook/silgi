/**
 * Astro adapter — use Katman with Astro API routes.
 *
 * @example
 * ```ts
 * // src/pages/api/rpc/[...path].ts
 * import { katmanAstro } from "katman/astro"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = katmanAstro(appRouter, {
 *   prefix: "/api/rpc",
 *   context: (req) => ({ db: getDB() }),
 * })
 *
 * export const GET = handler
 * export const POST = handler
 * export const ALL = handler
 * ```
 */

import type { RouterDef } from '../types.ts'

export interface AstroAdapterOptions<TCtx extends Record<string, unknown>> {
  context?: (request: Request) => TCtx | Promise<TCtx>
  prefix?: string
}

/**
 * Create an Astro API route handler.
 * Astro passes { request: Request, params } — uses Katman's handler().
 */
export function katmanAstro<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: AstroAdapterOptions<TCtx> = {},
): (ctx: { request: Request; params: Record<string, string> }) => Promise<Response> {
  const prefix = options.prefix ?? '/api/rpc'
  let _handler: ((req: Request) => Promise<Response>) | null = null

  return async ({ request }) => {
    if (!_handler) {
      const { katman } = await import('../katman.ts')
      const k = katman({ context: options.context ?? (() => ({}) as TCtx) })
      _handler = k.handler(router)
    }

    const url = new URL(request.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }

    return _handler(new Request(new URL(pathname + url.search, url.origin), request))
  }
}
