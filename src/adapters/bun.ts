/**
 * Bun adapter — optimized Bun.serve handler for Silgi.
 *
 * @example
 * ```ts
 * import { createHandler } from "silgi/bun"
 *
 * Bun.serve(createHandler(appRouter, { context: () => ({ db }) }))
 * ```
 */

import { createFetchHandler } from '../core/handler.ts'

import type { FetchHandler } from '../core/handler.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { RouterDef } from '../types.ts'
import type { Hookable } from 'hookable'

export interface BunAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Request */
  context?: (req: Request) => TCtx | Promise<TCtx>
  /** Lifecycle hooks (request, response, error). */
  hooks?: Hookable<SilgiHooks>
  /** Port. Default: 3000 */
  port?: number
  /** Hostname. Default: "0.0.0.0" */
  hostname?: string
}

/**
 * Create a Bun.serve() config with Silgi handler.
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: BunAdapterOptions<TCtx> = {},
): { port: number; hostname: string; fetch: FetchHandler } {
  const contextFactory = options.context ?? (() => ({}) as TCtx)
  const fetch = createFetchHandler(router, contextFactory as (req: Request) => Record<string, unknown>, options.hooks)

  return {
    port: options.port ?? 3000,
    hostname: options.hostname ?? '0.0.0.0',
    fetch,
  }
}
