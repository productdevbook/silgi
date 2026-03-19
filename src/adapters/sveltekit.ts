/**
 * SvelteKit adapter — use Katman with SvelteKit API routes.
 *
 * @example
 * ```ts
 * // src/routes/api/rpc/[...path]/+server.ts
 * import { katmanSvelteKit } from "katman/sveltekit"
 * import { appRouter } from "$lib/server/rpc"
 *
 * const handler = katmanSvelteKit(appRouter, {
 *   context: (event) => ({ db: getDB(), user: event.locals.user }),
 * })
 *
 * export const GET = handler
 * export const POST = handler
 * ```
 */

import type { RouterDef } from '../types.ts'

export interface SvelteKitAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the SvelteKit RequestEvent */
  context?: (event: any) => TCtx | Promise<TCtx>
  /** Route prefix to strip. Default: "/api/rpc" */
  prefix?: string
}

/**
 * Create a SvelteKit request handler.
 *
 * SvelteKit passes a RequestEvent with `.request` (standard Request).
 * The handler uses Katman's handler() for full protocol support.
 */
export function katmanSvelteKit<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: SvelteKitAdapterOptions<TCtx> = {},
): (event: any) => Promise<Response> {
  const prefix = options.prefix ?? '/api/rpc'

  let _handler: ((req: Request) => Promise<Response>) | null = null

  return async (event: any): Promise<Response> => {
    if (!_handler) {
      const { katman } = await import('../katman.ts')
      const k = katman({
        context: (req: Request) => {
          if (options.context) return options.context(event)
          return {} as TCtx
        },
      })
      _handler = k.handler(router)
    }

    const req: Request = event.request
    const url = new URL(req.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }

    const rewritten = new Request(new URL(pathname + url.search, url.origin), req)

    return _handler(rewritten)
  }
}
