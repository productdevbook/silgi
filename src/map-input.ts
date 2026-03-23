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
 * The mapper function receives the raw input and returns the transformed input.
 * The mapped input is set on the context as `__mappedInput` and picked up
 * by the pipeline.
 *
 * Note: Since Silgi's pipeline receives input as a separate argument
 * (not on ctx), mapInput works as a wrap that intercepts and transforms
 * before calling next().
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
