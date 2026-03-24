/**
 * callable() — turn a procedure into a directly invocable function.
 *
 * Useful for server-side code where you want to call a procedure
 * without going through HTTP or the client proxy.
 *
 * @example
 * ```ts
 * const getUsers = k
 *   .$input(z.object({ limit: z.number() }))
 *   .$resolve(({ input, ctx }) => ctx.db.users.findMany({ take: input.limit }))
 *
 * const fn = callable(getUsers, {
 *   context: () => ({ db: getDB() }),
 * })
 *
 * // Call it directly — no HTTP, no serialization
 * const users = await fn({ limit: 10 })
 * ```
 */

import { compileProcedure } from './compile.ts'

import type { ProcedureDef, ErrorDef } from './types.ts'

export interface CallableOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — called on every invocation */
  context: () => TCtx | Promise<TCtx>
  /** Default timeout in ms. Default: 30000. Set null to disable. */
  timeout?: number | null
}

type CallableFn<TInput, TOutput> = undefined extends TInput
  ? (input?: TInput) => Promise<TOutput>
  : (input: TInput) => Promise<TOutput>

/**
 * Convert a ProcedureDef into a directly callable async function.
 *
 * Compiles the full pipeline (guards, wraps, validation) once,
 * then each call runs the compiled handler directly — no HTTP overhead.
 */
export function callable<TInput, TOutput, TErrors extends ErrorDef, TCtx extends Record<string, unknown>>(
  procedure: ProcedureDef<any, TInput, TOutput, TErrors>,
  options: CallableOptions<TCtx>,
): CallableFn<TInput, TOutput> {
  const handler = compileProcedure(procedure)
  const contextFactory = options.context
  const defaultTimeout = options.timeout !== undefined ? options.timeout : 30_000

  return (async (input?: unknown) => {
    const ctx = await contextFactory()
    // Copy into null-prototype object (consistent with handler path)
    const ctxObj: Record<string, unknown> = Object.create(null)
    const keys = Object.keys(ctx)
    for (let i = 0; i < keys.length; i++) ctxObj[keys[i]!] = ctx[keys[i]!]

    // Fresh AbortSignal per call — supports timeout
    const signal = defaultTimeout !== null ? AbortSignal.timeout(defaultTimeout) : new AbortController().signal
    return handler(ctxObj, input, signal)
  }) as CallableFn<TInput, TOutput>
}
