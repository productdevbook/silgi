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
  let _initPromise: Promise<void> | null = null

  // Initialize handler eagerly (but only once)
  function ensureHandler(): Promise<void> {
    if (_handler) return Promise.resolve()
    return (_initPromise ??= import('../silgi.ts').then(({ silgi }) => {
      const k = silgi({
        // Context factory reads the per-request event from a request header token
        // that we set below — no shared mutable state.
        context: (_req: Request) => {
          const eventRef = requestEventMap.get(_req)
          if (options.context && eventRef) return options.context(eventRef)
          return {} as TCtx
        },
      })
      _handler = k.handler(router)
    }))
  }

  // Per-request event map — keyed by the rewritten Request object (unique per call)
  const requestEventMap = new WeakMap<Request, any>()

  return async (event: any): Promise<Response> => {
    await ensureHandler()

    const req: Request = event.request
    const url = new URL(req.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }

    const rewritten = new Request(new URL(pathname + url.search, url.origin), req)
    // Associate the SvelteKit event with this specific request — concurrency-safe
    requestEventMap.set(rewritten, event)

    return _handler!(rewritten)
  }
}
