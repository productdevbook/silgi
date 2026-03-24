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

import { createEventFetchAdapter } from './_fetch-adapter.ts'

import type { RouterDef } from '../types.ts'
import type { FetchAdapterConfigWithEvent } from './_fetch-adapter.ts'

export interface SvelteKitAdapterOptions<
  TCtx extends Record<string, unknown>,
> extends FetchAdapterConfigWithEvent<TCtx> {}

/**
 * Create a SvelteKit request handler.
 *
 * SvelteKit passes a RequestEvent with `.request` (standard Request).
 * The handler uses Silgi's handler() for full protocol support.
 */
export function silgiSvelteKit<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: SvelteKitAdapterOptions<TCtx> = {},
): (event: any) => Response | Promise<Response> {
  return createEventFetchAdapter(router, options, '/api/rpc', (event) => event.request)
}
