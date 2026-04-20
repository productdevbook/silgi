/**
 * createCaller — call procedures directly without HTTP.
 *
 * Compiles the router, creates context, and runs the pipeline
 * for each procedure call. Perfect for testing and server-side usage.
 *
 * @example
 * ```ts
 * const caller = s.createCaller(appRouter)
 *
 * // Call procedures directly
 * const users = await caller.users.list({ limit: 10 })
 * const user = await caller.users.get({ id: 1 })
 *
 * // With custom context override
 * const adminCaller = s.createCaller(appRouter, {
 *   contextOverride: { user: { id: 1, role: 'admin' } },
 * })
 * ```
 */

import { compileRouter, createContext, releaseContext } from './compile.ts'
import { applyContext } from './core/dispatch.ts'
import { routerCache } from './core/router-utils.ts'

import type { CompiledRouterFn } from './compile.ts'
import type { RouterDef } from './types.ts'

/**
 * Never-aborting signal used when `timeout: null` is opted into and the
 * caller passes no per-call signal. Allocated once at module load; compiled
 * handlers can still `.addEventListener('abort', …)` safely — the listener
 * simply never fires.
 */
const NEVER = new AbortController().signal

export interface CreateCallerOptions {
  /** Override or extend the base context for all calls */
  contextOverride?: Record<string, unknown>
  /** Mock request headers (used by context factory if it reads request) */
  headers?: Record<string, string>
  /** Default timeout in ms for all calls (default: 30000, null = no timeout) */
  timeout?: number | null
}

export interface CallerCallOptions {
  /** AbortSignal for this specific call */
  signal?: AbortSignal
  /** Per-call context override (merged over base context) */
  context?: Record<string, unknown>
}

/**
 * Create a direct caller for a router — no HTTP, no serialization.
 *
 * Returns a proxy that mirrors the router's nested structure.
 * Calling a leaf procedure invokes the compiled pipeline directly.
 */
export function createCaller(
  routerDef: RouterDef,
  contextFactory: ((req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined,
  options?: CreateCallerOptions,
): any {
  let compiledRouter = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  const router = compiledRouter
  const defaultTimeout = options?.timeout !== undefined ? options.timeout : 30_000

  function createMockRequest(extraHeaders?: Record<string, string>): Request {
    const headers = new Headers(options?.headers)
    if (extraHeaders) {
      for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v)
    }
    return new Request('http://localhost/__caller', { headers })
  }

  // Resolve context using the pool — null-prototype, consistent with handler path
  async function resolveContext(perCallContext?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const ctx = createContext()

    if (contextFactory) {
      const mockReq = createMockRequest()
      const result = contextFactory(mockReq)
      const baseCtx = result instanceof Promise ? await result : result
      applyContext(ctx, baseCtx)
    }

    if (options?.contextOverride) applyContext(ctx, options.contextOverride)
    if (perCallContext) applyContext(ctx, perCallContext)

    return ctx
  }

  function createProxy(segments: string[]): any {
    const cache = new Map<string, any>()

    return new Proxy(() => {}, {
      get(_target, prop: string | symbol) {
        if (typeof prop === 'symbol') return undefined
        if (prop === 'then' || prop === 'toJSON' || prop === 'toString' || prop === '$$typeof') {
          return undefined
        }

        let sub = cache.get(prop)
        if (!sub) {
          sub = createProxy([...segments, prop])
          cache.set(prop, sub)
        }
        return sub
      },

      apply(_target, _thisArg, args) {
        const path = '/' + segments.join('/')
        const input = args[0]
        const callOptions = args[1] as CallerCallOptions | undefined

        return (async () => {
          const match = router!('', path)
          if (!match) {
            throw new Error(`Procedure not found: ${path}`)
          }

          const ctx = await resolveContext(callOptions?.context)
          if (match.params) ctx.params = match.params

          // Compiled handlers may read `signal.aborted` / `.addEventListener`.
          // When `timeout: null` is opted into and no per-call signal is
          // supplied, we still hand over a real (never-aborting) signal
          // instead of `undefined` to avoid NPEs deep inside wraps/resolvers.
          const signal = callOptions?.signal ?? (defaultTimeout !== null ? AbortSignal.timeout(defaultTimeout) : NEVER)

          try {
            const result = match.data.handler(ctx, input, signal)
            return result instanceof Promise ? await result : result
          } finally {
            releaseContext(ctx)
          }
        })()
      },
    })
  }

  return createProxy([])
}
