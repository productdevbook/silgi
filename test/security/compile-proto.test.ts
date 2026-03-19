import { describe, expect, it } from 'vitest'

import { compileProcedure } from '#src/compile.ts'
import { katman } from '#src/katman.ts'

const k = katman({ context: () => ({}) })

describe('applyGuardResult — prototype pollution protection', () => {
  it('should not allow __proto__ key from guard result to pollute context', async () => {
    const maliciousGuard = k.guard(() => {
      // Simulate a guard that returns user-controlled data with __proto__
      return JSON.parse('{"__proto__": {"isAdmin": true}, "name": "attacker"}')
    })

    const proc = k.query()
      .$use(maliciousGuard)
      .$resolve(({ ctx }) => ({
        name: (ctx as any).name,
        // __proto__ should NOT be set on a null-prototype ctx
        proto: (ctx as any).__proto__,
      }))

    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = Object.create(null)
    const result = (await handler(ctx, undefined, AbortSignal.timeout(1000))) as any

    expect(result.name).toBe('attacker')
    // __proto__ key should be filtered out
    expect(result.proto).toBeUndefined()
    expect(ctx.__proto__).toBeUndefined()
  })

  it('should not allow constructor key from guard result', async () => {
    const maliciousGuard = k.guard(() => {
      return JSON.parse('{"constructor": {"prototype": {"isAdmin": true}}, "ok": true}')
    })

    const proc = k.query()
      .$use(maliciousGuard)
      .$resolve(({ ctx }) => ({
        ok: (ctx as any).ok,
        constructor: (ctx as any).constructor,
      }))

    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = Object.create(null)
    const result = (await handler(ctx, undefined, AbortSignal.timeout(1000))) as any

    expect(result.ok).toBe(true)
    // constructor key should be filtered out
    expect(result.constructor).toBeUndefined()
  })
})
