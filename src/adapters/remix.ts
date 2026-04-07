/**
 * Remix adapter — use Silgi with Remix action/loader routes.
 *
 * @example
 * ```ts
 * // app/routes/api.$.tsx
 * import { createHandler } from "silgi/remix"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = createHandler(appRouter, {
 *   context: (req) => ({ db: getDB() }),
 *   analytics: true,
 * })
 *
 * export const action = handler
 * export const loader = handler
 * ```
 */

import { createFetchAdapter } from './_fetch-adapter.ts'

import type { RouterDef } from '../types.ts'
import type { FetchAdapterConfig } from './_fetch-adapter.ts'

export interface RemixAdapterOptions<TCtx extends Record<string, unknown>> extends FetchAdapterConfig<TCtx> {}

/**
 * Create a Remix action/loader handler.
 * Remix passes { request, params } — we extract request and delegate.
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: RemixAdapterOptions<TCtx> = {},
): (args: { request: Request; params: Record<string, string> }) => Response | Promise<Response> {
  const handler = createFetchAdapter(router, options, '/api')
  return ({ request }) => handler(request)
}
