/**
 * Server-side client — call procedures directly without HTTP.
 *
 * Useful for SSR, server components, and testing where you want the
 * same typed client interface but without network overhead.
 *
 * @example
 * ```ts
 * import { createServerClient } from "silgi/client/server"
 *
 * const client = createServerClient(appRouter, {
 *   context: () => ({ db: getDB() }),
 * })
 *
 * // Same typed API as the HTTP client — but runs in-process
 * const users = await client.users.list({ limit: 10 })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { resolveRoute } from '../core/router-utils.ts'

import type { CompiledRouterFn } from '../compile.ts'
import type { RouterDef, InferClient } from '../types.ts'

export interface ServerClientOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — called for every procedure call */
  context: () => TCtx | Promise<TCtx>
}

/**
 * Create a type-safe client that calls procedures directly in-process.
 *
 * No HTTP, no serialization, no network — just compiled pipeline execution.
 * Uses the same compiled handlers as serve() and handler().
 */
export function createServerClient<TRouter extends RouterDef, TCtx extends Record<string, unknown>>(
  router: TRouter,
  options: ServerClientOptions<TCtx>,
): InferClient<TRouter> {
  const flatRouter = compileRouter(router)
  return createServerProxy(router, flatRouter, options.context, []) as InferClient<TRouter>
}

function createServerProxy(
  router: unknown,
  flatRouter: CompiledRouterFn,
  contextFactory: () => Record<string, unknown> | Promise<Record<string, unknown>>,
  path: string[],
): unknown {
  const cache = new Map<string, unknown>()

  const callProcedure = async (input?: unknown) => {
    // Resolve custom $route({ path, method }) if present
    const resolved = resolveRoute(router, path)
    const routePath = resolved?.path ?? '/' + path.join('/')
    const method = resolved?.method ?? 'POST'
    const route = flatRouter(method, routePath)?.data
    if (!route) throw new Error(`Procedure not found: ${path.join('/')}`)
    const ctx: Record<string, unknown> = Object.create(null)
    const baseCtx = await contextFactory()
    const keys = Object.keys(baseCtx)
    for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
    const signal = new AbortController().signal
    return route.handler(ctx, input, signal)
  }

  return new Proxy(callProcedure, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return undefined
      let cached = cache.get(prop)
      if (!cached) {
        cached = createServerProxy(router, flatRouter, contextFactory, [...path, prop])
        cache.set(prop, cached)
      }
      return cached
    },
    apply(_target, _thisArg, args) {
      return callProcedure(args[0])
    },
  })
}
