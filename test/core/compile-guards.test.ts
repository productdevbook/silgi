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

  it('guard returning class instance — properties are applied to context', async () => {
    class AuthResult {
      userId: number
      role: string
      constructor(userId: number, role: string) {
        this.userId = userId
        this.role = role
      }

      get isAdmin() {
        return this.role === 'admin'
      }
    }

    const auth = k.guard(() => new AuthResult(42, 'admin'))
    const proc = k.query({
      use: [auth],
      resolve: ({ ctx }) => ({
        userId: (ctx as any).userId,
        role: (ctx as any).role,
      }),
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = (await handler(ctx, undefined, AbortSignal.timeout(1000))) as any
    expect(result.userId).toBe(42)
    expect(result.role).toBe('admin')
  })

  it('guard returning void — context unchanged', async () => {
    const sideEffect = k.guard(() => {
      // side effect only, no return
    })
    const proc = k.query({
      use: [sideEffect],
      resolve: () => 'ok',
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe('ok')
  })

  it('guard returning null — context unchanged', async () => {
    const g = k.guard(() => null as any)
    const proc = k.query({
      use: [g],
      resolve: () => 'ok',
    })
    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await handler(ctx, undefined, AbortSignal.timeout(1000))
    expect(result).toBe('ok')
  })

  it('guard with typed errors — fail() works with merged error codes', async () => {
    const auth = k.guard({
      errors: { UNAUTHORIZED: 401 },
      fn: () => ({ userId: 1 }),
    })

    const proc = k.mutation({
      use: [auth],
      errors: { CONFLICT: 409 },
      resolve: ({ fail }) => {
        fail('UNAUTHORIZED')
      },
    })

    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    try {
      await handler(ctx, undefined, AbortSignal.timeout(1000))
      expect.unreachable()
    } catch (err: any) {
      expect(err.code).toBe('UNAUTHORIZED')
      expect(err.status).toBe(401)
      expect(err.defined).toBe(true)
    }
  })

  it('guard errors merge with procedure errors in fail()', async () => {
    const rateLimit = k.guard({
      errors: { RATE_LIMITED: 429 },
      fn: () => {},
    })

    const proc = k.mutation({
      use: [rateLimit],
      errors: { NOT_FOUND: 404 },
      resolve: ({ fail }) => {
        fail('RATE_LIMITED')
      },
    })

    const handler = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    try {
      await handler(ctx, undefined, AbortSignal.timeout(1000))
      expect.unreachable()
    } catch (err: any) {
      expect(err.code).toBe('RATE_LIMITED')
      expect(err.status).toBe(429)
      expect(err.defined).toBe(true)
    }
  })
})
