/**
 * Middleware lifecycle hooks — declarative before/after/error/finally.
 *
 * A higher-level abstraction over wraps that provides named lifecycle
 * callbacks instead of manual try/catch/finally patterns.
 *
 * @example
 * ```ts
 * import { lifecycleWrap } from "katman"
 *
 * const logging = lifecycleWrap({
 *   onStart: () => console.log("procedure started"),
 *   onSuccess: ({ output, durationMs }) => console.log(`done in ${durationMs}ms`),
 *   onError: ({ error }) => reportToSentry(error),
 *   onFinish: () => cleanup(),
 * })
 *
 * const listUsers = k.query()
 *   .$use(logging)
 *   .$resolve(({ ctx }) => ctx.db.users.findMany())
 * ```
 */

import type { WrapDef } from './types.ts'

export interface LifecycleHooks<TCtx = Record<string, unknown>> {
  /** Called before the procedure runs */
  onStart?: (event: { ctx: TCtx }) => void | Promise<void>
  /** Called after a successful result */
  onSuccess?: (event: { ctx: TCtx; output: unknown; durationMs: number }) => void | Promise<void>
  /** Called when the procedure throws */
  onError?: (event: { ctx: TCtx; error: unknown; durationMs: number }) => void | Promise<void>
  /** Called after the procedure completes (success or failure) */
  onFinish?: (event: { ctx: TCtx; durationMs: number; error?: unknown }) => void | Promise<void>
}

/**
 * Create a wrap middleware with declarative lifecycle hooks.
 *
 * All hooks are optional. The procedure result is never modified —
 * hooks are purely for side effects (logging, metrics, error reporting).
 */
export function lifecycleWrap<TCtx = Record<string, unknown>>(hooks: LifecycleHooks<TCtx>): WrapDef<TCtx> {
  return {
    kind: 'wrap',
    fn: async (ctx, next) => {
      const typedCtx = ctx as TCtx

      if (hooks.onStart) await hooks.onStart({ ctx: typedCtx })

      const t0 = performance.now()
      let error: unknown

      try {
        const output = await next()
        const durationMs = performance.now() - t0

        if (hooks.onSuccess) await hooks.onSuccess({ ctx: typedCtx, output, durationMs })

        return output
      } catch (err) {
        error = err
        const durationMs = performance.now() - t0

        if (hooks.onError) await hooks.onError({ ctx: typedCtx, error: err, durationMs })

        throw err
      } finally {
        const durationMs = performance.now() - t0
        if (hooks.onFinish) await hooks.onFinish({ ctx: typedCtx, durationMs, error })
      }
    },
  }
}
