/**
 * Astro adapter — use Silgi with Astro API routes.
 *
 * @example
 * ```ts
 * // src/pages/api/rpc/[...path].ts
 * import { silgiAstro } from "silgi/astro"
 * import { appRouter } from "~/server/rpc"
 *
 * const handler = silgiAstro(appRouter, {
 *   prefix: "/api/rpc",
 *   context: (req) => ({ db: getDB() }),
 * })
 *
 * export const GET = handler
 * export const POST = handler
 * export const ALL = handler
 * ```
 */

import { createFetchAdapter } from './_fetch-adapter.ts'

import type { RouterDef } from '../types.ts'
import type { FetchAdapterConfig } from './_fetch-adapter.ts'

export interface AstroAdapterOptions<TCtx extends Record<string, unknown>> extends FetchAdapterConfig<TCtx> {}

/**
 * Create an Astro API route handler.
 * Astro passes { request, params } — we extract request and delegate.
 */
export function silgiAstro<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: AstroAdapterOptions<TCtx> = {},
): (ctx: { request: Request; params: Record<string, string> }) => Response | Promise<Response> {
  const handler = createFetchAdapter(router, options, '/api/rpc')
  return ({ request }) => handler(request)
}
