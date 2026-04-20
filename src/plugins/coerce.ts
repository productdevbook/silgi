/**
 * Smart coercion — convert string query parameters to proper types.
 *
 * When procedures receive GET requests, input arrives as strings via
 * query parameters. This wrap coerces common types automatically:
 * "123" → 123, "true" → true, "null" → null, etc.
 *
 * @remarks
 * **Ordering caveat.** The pipeline validates `$input` schemas *before*
 * running the wrap onion. That means a plain `z.number()` rejects "123"
 * before this wrap can see it. You have three options:
 *
 * 1. **Use Zod's own coercion** — `z.coerce.number()`, `z.coerce.boolean()`.
 *    Zero extra wrap, works for simple cases.
 * 2. **Skip the input schema and validate inside the resolver** — pairs
 *    naturally with `coerceGuard` because the wrap always runs first.
 * 3. **Use a string-accepting schema and coerce with `.transform()`** —
 *    e.g. `z.object({ id: z.string().transform(Number) })`. Again no
 *    wrap needed.
 *
 * `coerceGuard` itself is useful when you have NO input schema but still
 * want `"42"` / `"true"` / `"null"` normalised before your resolver runs.
 *
 * @example
 * ```ts
 * // Works: no schema → wrap can reshape freely.
 * const getUser = k
 *   .$use(coerceGuard)
 *   .$resolve(({ input }) => db.users.find((input as any).id))
 *
 * // Works: schema uses z.coerce.
 * const getUser2 = k
 *   .$input(z.object({ id: z.coerce.number() }))
 *   .$resolve(({ input }) => db.users.find(input.id))
 * ```
 */

import { RAW_INPUT } from '../compile.ts'

import type { WrapDef } from '../types.ts'

/**
 * Coerce string values in the input to their proper JavaScript types.
 * Only processes top-level and one-level-deep object values.
 *
 * Rules:
 * - "123", "-42", "3.14" → number
 * - "true", "false" → boolean
 * - "null" → null
 * - "undefined" → undefined
 * - "" → undefined (empty strings become undefined)
 * - Everything else → kept as-is
 *
 * Implemented as a wrap so it runs after the pipeline has populated the
 * `RAW_INPUT` slot on ctx — see the caveat in the top-level docstring
 * about ordering vs. input schema validation.
 */
export const coerceGuard: WrapDef<Record<string, unknown>> = {
  kind: 'wrap',
  fn: async (ctx, next) => {
    const input = (ctx as any)[RAW_INPUT]
    if (typeof input === 'object' && input !== null) {
      coerceObject(input as Record<string, unknown>)
    }
    return next()
  },
}

function coerceValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  if (value === '') return undefined
  if (value === 'null') return null
  if (value === 'undefined') return undefined
  if (value === 'true') return true
  if (value === 'false') return false

  // Number coercion — only if the entire string is a valid number
  if (value.length > 0 && value.length <= 20) {
    const num = Number(value)
    if (!Number.isNaN(num) && String(num) === value) return num
  }

  return value
}

function coerceObject(obj: Record<string, unknown>): void {
  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!
    const val = obj[key]
    if (typeof val === 'string') {
      obj[key] = coerceValue(val)
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      coerceObject(val as Record<string, unknown>)
    } else if (Array.isArray(val)) {
      for (let j = 0; j < val.length; j++) {
        val[j] = coerceValue(val[j])
      }
    }
  }
}

/** Standalone coercion function — use outside of guards */
export { coerceValue, coerceObject }
