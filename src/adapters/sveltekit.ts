/**
 * SvelteKit adapter — use Silgi with SvelteKit API routes.
 *
 * @example
 * ```ts
 * // src/routes/api/rpc/[...path]/+server.ts
 * import { silgiSvelteKit } from "silgi/sveltekit"
 * import { appRouter } from "$lib/server/rpc"
 *
 * const handler = silgiSvelteKit(appRouter, {
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
 * The handler uses Silgi's handler() for full protocol support.
 */
export function silgiSvelteKit<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: SvelteKitAdapterOptions<TCtx> = {},
): (event: any) => Promise<Response> {
  const prefix = options.prefix ?? '/api/rpc'

  let _handler: ((req: Request) => Response | Promise<Response>) | null = null
  let _currentEvent: any = null

  return async (event: any): Promise<Response> => {
    _currentEvent = event
    if (!_handler) {
      const { silgi } = await import('../silgi.ts')
      const k = silgi({
        context: (_req: Request) => {
          if (options.context) return options.context(_currentEvent)
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
