/**
 * SolidStart adapter — use Silgi with SolidStart API routes.
 *
 * @example
 * ```ts
 * // src/routes/api/[...path].ts
 * import { createHandler } from "silgi/solidstart"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = createHandler(appRouter, {
 *   context: (event) => ({ db: getDB() }),
 *   analytics: { auth: "your-secret-token" },
 * })
 *
 * export const GET = handler
 * export const POST = handler
 * ```
 */

import { createEventFetchAdapter } from './_fetch-adapter.ts'

import type { RouterDef } from '../types.ts'
import type { FetchAdapterConfigWithEvent } from './_fetch-adapter.ts'

export interface SolidStartAdapterOptions<
  TCtx extends Record<string, unknown>,
> extends FetchAdapterConfigWithEvent<TCtx> {}

/**
 * Create a SolidStart API route handler.
 * SolidStart uses Fetch API events — uses Silgi's handler().
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: SolidStartAdapterOptions<TCtx> = {},
): (event: any) => Response | Promise<Response> {
  return createEventFetchAdapter(router, options, '/api', (event) => event.request ?? event)
}
