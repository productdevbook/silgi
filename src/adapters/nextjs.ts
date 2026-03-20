/**
 * Next.js adapter — use Silgi with App Router API routes.
 *
 * @example
 * ```ts
 * // app/api/rpc/[...path]/route.ts
 * import { silgiNextjs } from "silgi/nextjs"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = silgiNextjs(appRouter, {
 *   context: (req) => ({ db: getDB() }),
 * })
 *
 * export { handler as GET, handler as POST }
 * ```
 */

import type { RouterDef } from '../types.ts'

export interface NextjsAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Next.js Request */
  context?: (req: Request) => TCtx | Promise<TCtx>
  /** Route prefix to strip. Default: "/api/rpc" */
  prefix?: string
}

/**
 * Create a Next.js App Router route handler.
 *
 * Uses Silgi's handler() internally — full Fetch API support
 * including content negotiation (JSON, MessagePack, devalue).
 *
 * The handler strips the prefix from the URL path before dispatching
 * to the Silgi router.
 */
export function silgiNextjs<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: NextjsAdapterOptions<TCtx> = {},
): (req: Request) => Promise<Response> {
  const prefix = options.prefix ?? '/api/rpc'

  // Lazy import to avoid bundling silgi() in edge runtime
  let _handler: ((req: Request) => Promise<Response>) | null = null

  return async (req: Request): Promise<Response> => {
    if (!_handler) {
      const { silgi } = await import('../silgi.ts')
      const k = silgi({
        context: options.context ?? (() => ({}) as TCtx),
      })
      _handler = k.handler(router)
    }

    // Rewrite URL to strip prefix
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
