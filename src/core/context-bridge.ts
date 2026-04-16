/**
 * Per-instance context bridge built on `AsyncLocalStorage`.
 *
 * @remarks
 * Each silgi instance owns its own bridge, preventing context bleed
 * between multiple `silgi()` instances in the same process. The bridge
 * is created lazily in `silgi()` and exposed on the instance as
 * {@link SilgiInstance.runInContext} / {@link SilgiInstance.currentContext}.
 *
 * The top-level `getCtx` / `runWithCtx` free functions that previously
 * lived in this module have been removed — they were module-global and
 * silently shared state across instances.
 *
 * @category Context
 */

import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Wraps an `AsyncLocalStorage` with a small typed surface. Call
 * {@link createContextBridge} to construct one.
 *
 * @typeParam TCtx - Context shape stored in the bridge.
 * @category Context
 */
export interface ContextBridge<TCtx extends Record<string, unknown> = Record<string, unknown>> {
  /** Execute `fn` with `ctx` installed on the current async scope. */
  run<T>(ctx: TCtx, fn: () => T): T
  /** Read the context installed by the nearest enclosing `run()` call, or `undefined`. */
  current(): TCtx | undefined
}

/**
 * Create a fresh {@link ContextBridge}. Each silgi instance calls this
 * once internally; integrations that need their own ambient scope (e.g.
 * for programmatic `withCtx()` helpers) can also call it.
 *
 * @typeParam TCtx - Context shape to store.
 *
 * @example
 * ```ts
 * const bridge = createContextBridge<{ userId: string }>()
 * bridge.run({ userId: 'u_1' }, () => {
 *   bridge.current()?.userId // 'u_1'
 * })
 * ```
 *
 * @category Context
 */
export function createContextBridge<
  TCtx extends Record<string, unknown> = Record<string, unknown>,
>(): ContextBridge<TCtx> {
  const storage = new AsyncLocalStorage<TCtx>()
  return {
    run<T>(ctx: TCtx, fn: () => T): T {
      return storage.run(ctx, fn)
    },
    current(): TCtx | undefined {
      return storage.getStore()
    },
  }
}
