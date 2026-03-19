import { describe, expect, it } from 'vitest'

import { compileProcedure } from '#src/compile.ts'
import { katman } from '#src/katman.ts'

const k = katman({ context: () => ({}) })

describe('compileProcedure guard count specialization', () => {
  it('0 guards — direct resolve', async () => {
    const proc = k.query(() => 'no-guards')
    const handler = compileProcedure(proc)
    const result = await handler({}, undefined, AbortSignal.timeout(1000))
    expect(result).toBe('no-guards')
  })

  it('1 guard', async () => {
    const g0 = k.guard(() => ({ a: 1 }))
    const proc = k.query({ use: [g0], resolve: ({ ctx }) => (ctx as any).a })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe(1)
  })

  it('2 guards', async () => {
    const g0 = k.guard(() => ({ a: 1 }))
    const g1 = k.guard(() => ({ b: 2 }))
    const proc = k.query({
      use: [g0, g1],
      resolve: ({ ctx }) => (ctx as any).a + (ctx as any).b,
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe(3)
  })

  it('3 guards', async () => {
    const g0 = k.guard(() => ({ a: 1 }))
    const g1 = k.guard(() => ({ b: 2 }))
    const g2 = k.guard(() => ({ c: 3 }))
    const proc = k.query({
      use: [g0, g1, g2],
      resolve: ({ ctx }) => (ctx as any).a + (ctx as any).b + (ctx as any).c,
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe(6)
  })

  it('4 guards', async () => {
    const g0 = k.guard(() => ({ a: 1 }))
    const g1 = k.guard(() => ({ b: 2 }))
    const g2 = k.guard(() => ({ c: 3 }))
    const g3 = k.guard(() => ({ d: 4 }))
    const proc = k.query({
      use: [g0, g1, g2, g3],
      resolve: ({ ctx }) => (ctx as any).a + (ctx as any).b + (ctx as any).c + (ctx as any).d,
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe(10)
  })

  it('5+ guards — runGuardsN fallback', async () => {
    const guards = Array.from({ length: 6 }, (_, i) => k.guard(() => ({ [`g${i}`]: i })))
    const proc = k.query({
      use: guards,
      resolve: ({ ctx }) => {
        let sum = 0
        for (let i = 0; i < 6; i++) sum += (ctx as any)[`g${i}`]
        return sum
      },
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe(0 + 1 + 2 + 3 + 4 + 5)
  })

  it('async guards', async () => {
    const g0 = k.guard(async () => ({ a: 'async1' }))
    const g1 = k.guard(async () => ({ b: 'async2' }))
    const proc = k.query({
      use: [g0, g1],
      resolve: ({ ctx }) => `${(ctx as any).a}-${(ctx as any).b}`,
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe('async1-async2')
  })
})
