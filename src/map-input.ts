/**
 * mapInput — transform the input shape before a procedure runs.
 *
 * Useful when the client sends data in one shape but the procedure
 * expects a different shape, or when you want to pre-process input
 * in a reusable way.
 *
 * @example
 * ```ts
 * import { mapInput } from "silgi"
 *
 * // Rename fields
 * const mapUserId = mapInput((input: { userId: string }) => ({
 *   id: input.userId,
 * }))
 *
 * const getUser = k
 *   .$use(mapUserId)
 *   .$resolve(({ input }) => db.users.find(input.id))
 *   // input is { id: string } after mapping
 * ```
 */

import { RAW_INPUT } from './compile.ts'

import type { WrapDef } from './types.ts'

/**
 * Create a wrap that transforms the procedure input before execution.
 *
 * @remarks
 * The mapper receives the raw input and returns the transformed input.
 * Internally this wrap replaces the value in the pipeline's `RAW_INPUT`
 * symbol slot on `ctx`; the resolver reads the same slot to get the
 * rewritten input. Users never interact with the slot directly — it's
 * framework-internal (see `src/core/ctx-symbols.ts`).
 *
 * Must run inside the wrap onion (not as a guard) so it can observe and
 * mutate the already-parsed input after schema validation.
 */
export function mapInput<TIn = unknown, TOut = unknown>(mapper: (input: TIn) => TOut | Promise<TOut>): WrapDef {
  return {
    kind: 'wrap',
    fn: async (ctx, next) => {
      // Access the raw input from context (set by the pipeline)
      const rawInput = (ctx as any)[RAW_INPUT]
      const mapped = await mapper(rawInput as TIn)
      ;(ctx as any)[RAW_INPUT] = mapped
      return next()
    },
  }
}
