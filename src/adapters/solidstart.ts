/**
 * SolidStart adapter — use Silgi with SolidStart API routes.
 *
 * @example
 * ```ts
 * // src/routes/api/rpc/[...path].ts
 * import { silgiSolidStart } from "silgi/solidstart"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = silgiSolidStart(appRouter, {
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
 * SolidStart uses Fetch API events — uses Silgi's handler().
 */
export function silgiSolidStart<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: SolidStartAdapterOptions<TCtx> = {},
): (event: any) => Promise<Response> {
  const prefix = options.prefix ?? '/api/rpc'
  let _handler: ((req: Request) => Response | Promise<Response>) | null = null
  let _initPromise: Promise<void> | null = null

  // Per-request event map — keyed by the rewritten Request object (unique per call)
  const requestEventMap = new WeakMap<Request, any>()

  function ensureHandler(): Promise<void> {
    if (_handler) return Promise.resolve()
    return (_initPromise ??= import('../silgi.ts').then(({ silgi }) => {
      const k = silgi({
        context: (_req: Request) => {
          const eventRef = requestEventMap.get(_req)
          if (options.context && eventRef) return options.context(eventRef)
          return {} as TCtx
        },
      })
      _handler = k.handler(router)
    }))
  }

  return async (event: any) => {
    await ensureHandler()

    const request: Request = event.request ?? event
    const url = new URL(request.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }

    const rewritten = new Request(new URL(pathname + url.search, url.origin), request)
    // Associate the framework event with this specific request — concurrency-safe
    requestEventMap.set(rewritten, event)

    return _handler!(rewritten)
  }
}
