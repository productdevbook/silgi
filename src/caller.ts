/**
 * Direct caller
 * --------------
 *
 * `createCaller` returns a proxy that mirrors the router's nested shape.
 * Calling a leaf procedure invokes the compiled pipeline directly — no
 * HTTP, no body serialization, no response encoding. This is what tests
 * and server-side orchestration code use.
 *
 * @example
 *   const caller = s.createCaller(appRouter)
 *   const users = await caller.users.list({ limit: 10 })
 *   const user  = await caller.users.get({ id: 1 })
 *
 *   // Override the context for this caller (e.g. for admin tests):
 *   const admin = s.createCaller(appRouter, {
 *     contextOverride: { user: { id: 1, role: 'admin' } },
 *   })
 */

import { compileRouter } from './compile.ts'
import { applyContext } from './core/dispatch.ts'
import { routerCache } from './core/router-utils.ts'

import type { CompiledRouterFn } from './compile.ts'
import type { RouterDef } from './types.ts'

/**
 * Placeholder signal for callers that opt out of timeouts (`timeout: null`)
 * and do not pass their own signal. We still hand the pipeline a real
 * `AbortSignal` so that user code doing `signal.addEventListener('abort', …)`
 * does not crash on `undefined` — this signal just never fires.
 */
const NEVER_ABORTS = new AbortController().signal

export interface CreateCallerOptions {
  /** Override or extend the base context for every call made through this caller. */
  contextOverride?: Record<string, unknown>
  /** Mock request headers — passed to the context factory as if a request carried them. */
  headers?: Record<string, string>
  /** Default timeout in ms for all calls. Default: 30000. Pass `null` to disable. */
  timeout?: number | null
}

export interface CallerCallOptions {
  /** `AbortSignal` scoped to this single call. Overrides the default timeout signal. */
  signal?: AbortSignal
  /** Per-call context patch, merged on top of the base context. */
  context?: Record<string, unknown>
}

/**
 * Build a direct caller for a router.
 *
 * The returned value is a proxy that mirrors the router tree: accessing
 * `caller.users.list` returns another proxy; calling it at the leaf
 * dispatches to the compiled pipeline for that procedure.
 */
export function createCaller(
  routerDef: RouterDef,
  contextFactory: ((req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>) | undefined,
  options?: CreateCallerOptions,
): any {
  // Router compilation is keyed off the user's def via a `WeakMap`, so the
  // caller, fetch handler, and WS adapter all share the same compiled tree.
  let compiled = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiled) {
    compiled = compileRouter(routerDef)
    routerCache.set(routerDef, compiled)
  }

  const defaultTimeoutMs = options?.timeout !== undefined ? options.timeout : 30_000

  /**
   * Construct a mock `Request` to feed into the user's context factory.
   * Tests rarely care about the URL — only the headers matter, because
   * that is the surface most factories actually read.
   */
  const mockRequest = (extraHeaders?: Record<string, string>): Request => {
    const headers = new Headers(options?.headers)
    if (extraHeaders) {
      for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value)
    }
    return new Request('http://localhost/__caller', { headers })
  }

  /**
   * Build a fresh context for a single call. Layers are applied in the
   * order they would be on the HTTP path: context factory → caller-level
   * `contextOverride` → per-call override.
   */
  const buildContext = async (perCallContext?: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const ctx = Object.create(null) as Record<string, unknown>

    if (contextFactory) {
      const baseCtx = await contextFactory(mockRequest())
      applyContext(ctx, baseCtx)
    }

    if (options?.contextOverride) applyContext(ctx, options.contextOverride)
    if (perCallContext) applyContext(ctx, perCallContext)

    return ctx
  }

  /**
   * Build a proxy node for the current `segments` path. Each property
   * access descends one level; each function call dispatches to the
   * compiled pipeline.
   *
   * The `cache` map ensures repeated property access (e.g.
   * `caller.users.list`) returns the same proxy object so equality
   * checks and `.bind` in user tests stay stable.
   */
  const createProxy = (segments: string[]): any => {
    const cache = new Map<string, any>()

    return new Proxy(() => {}, {
      get(_target, prop) {
        if (typeof prop === 'symbol') return undefined

        // These are properties Promise-like and serializer code probes for;
        // returning `undefined` stops the proxy from pretending it is one,
        // which would confuse `await` and `JSON.stringify` callers.
        if (prop === 'then' || prop === 'toJSON' || prop === 'toString' || prop === '$$typeof') {
          return undefined
        }

        let child = cache.get(prop)
        if (!child) {
          child = createProxy([...segments, prop])
          cache.set(prop, child)
        }
        return child
      },

      apply(_target, _thisArg, args) {
        const path = '/' + segments.join('/')
        const input = args[0] as unknown
        const callOptions = args[1] as CallerCallOptions | undefined

        return (async () => {
          // The empty-method slot is what `compileRouter` registers for
          // direct (non-HTTP) callers. See `compile.ts` → `register`.
          const match = compiled!('', path)
          if (!match) {
            throw new Error(`Procedure not found: ${path}`)
          }

          const ctx = await buildContext(callOptions?.context)
          if (match.params) ctx.params = match.params

          const signal =
            callOptions?.signal ?? (defaultTimeoutMs !== null ? AbortSignal.timeout(defaultTimeoutMs) : NEVER_ABORTS)

          return await match.data.handler(ctx, input, signal)
        })()
      },
    })
  }

  return createProxy([])
}
