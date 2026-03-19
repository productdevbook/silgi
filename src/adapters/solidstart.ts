/**
 * SolidStart adapter — use Katman with SolidStart API routes.
 *
 * @example
 * ```ts
 * // src/routes/api/rpc/[...path].ts
 * import { katmanSolidStart } from "katman/solidstart"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = katmanSolidStart(appRouter, {
 *   prefix: "/api/rpc",
 *   context: (event) => ({ db: getDB() }),
 * })
 *
 * export const GET = handler
 * export const POST = handler
 * ```
 */

import type { RouterDef } from '../types.ts'

export interface SolidStartAdapterOptions<TCtx extends Record<string, unknown>> {
  context?: (event: any) => TCtx | Promise<TCtx>
  prefix?: string
}

/**
 * Create a SolidStart API route handler.
 * SolidStart uses Fetch API events — uses Katman's handler().
 */
export function katmanSolidStart<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: SolidStartAdapterOptions<TCtx> = {},
): (event: any) => Promise<Response> {
  const prefix = options.prefix ?? '/api/rpc'
  let _handler: ((req: Request) => Promise<Response>) | null = null
  let _currentEvent: any = null

  return async (event: any) => {
    _currentEvent = event
    if (!_handler) {
      const { katman } = await import('../katman.ts')
      const k = katman({
        context: (_req: Request) => {
          if (options.context) return options.context(_currentEvent)
          return {} as TCtx
        },
      })
      _handler = k.handler(router)
    }

    const request: Request = event.request ?? event
    const url = new URL(request.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }

    return _handler(new Request(new URL(pathname + url.search, url.origin), request))
  }
}
