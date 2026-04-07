/**
 * Next.js adapter — use Silgi with App Router API routes.
 *
 * @example
 * ```ts
 * // app/api/[...path]/route.ts
 * import { createHandler } from "silgi/nextjs"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = createHandler(appRouter, {
 *   context: (req) => ({ db: getDB() }),
 *   analytics: true,
 * })
 *
 * export { handler as GET, handler as POST }
 * ```
 */

import { createFetchAdapter } from './_fetch-adapter.ts'

import type { RouterDef } from '../types.ts'
import type { FetchAdapterConfig } from './_fetch-adapter.ts'

export interface NextjsAdapterOptions<TCtx extends Record<string, unknown>> extends FetchAdapterConfig<TCtx> {}

/**
 * Create a Next.js App Router route handler.
 *
 * Uses Silgi's handler() internally — full Fetch API support
 * including content negotiation (JSON, MessagePack, devalue).
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: NextjsAdapterOptions<TCtx> = {},
): (req: Request) => Response | Promise<Response> {
  return createFetchAdapter(router, options, '/api')
}
