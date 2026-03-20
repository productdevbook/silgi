/**
 * Smart coercion — convert string query parameters to proper types.
 *
 * When procedures receive GET requests, input arrives as strings via
 * query parameters. This guard coerces common types automatically:
 * "123" → 123, "true" → true, "null" → null, etc.
 *
 * @example
 * ```ts
 * import { coerceGuard } from "silgi/plugins"
 *
 * const getUser = k
 *   .$use(coerceGuard)
 *   .$input(z.object({ id: z.number(), active: z.boolean().optional() }))
 *   .$resolve(({ input }) => db.users.find(input.id))
 *
 * // GET /users/get?data={"id":"42","active":"true"}
 * // → input is coerced to { id: 42, active: true }
 * ```
 */

import type { GuardDef } from '../types.ts'

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
 */
export const coerceGuard: GuardDef<Record<string, unknown>> = {
  kind: 'guard',
  fn: (ctx: Record<string, unknown>) => {
    const input = ctx.__rawInput
    if (typeof input !== 'object' || input === null) return
    coerceObject(input as Record<string, unknown>)
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
