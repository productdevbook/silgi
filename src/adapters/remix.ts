/**
 * Remix adapter — use Silgi with Remix action/loader routes.
 *
 * @example
 * ```ts
 * // app/routes/rpc.$.tsx
 * import { silgiRemix } from "silgi/remix"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = silgiRemix(appRouter, {
 *   prefix: "/rpc",
 *   context: (req) => ({ db: getDB() }),
 * })
 *
 * export const action = handler
 * export const loader = handler
 * ```
 */

import type { RouterDef } from '../types.ts'

export interface RemixAdapterOptions<TCtx extends Record<string, unknown>> {
  context?: (request: Request) => TCtx | Promise<TCtx>
  prefix?: string
}

/**
 * Create a Remix action/loader handler.
 * Uses Silgi's handler() — full Fetch API + content negotiation.
 */
export function silgiRemix<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: RemixAdapterOptions<TCtx> = {},
): (args: { request: Request; params: Record<string, string> }) => Promise<Response> {
  const prefix = options.prefix ?? '/rpc'
  let _handler: ((req: Request) => Promise<Response>) | null = null

  return async ({ request }) => {
    if (!_handler) {
      const { silgi } = await import('../silgi.ts')
      const k = silgi({ context: options.context ?? (() => ({}) as TCtx) })
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
