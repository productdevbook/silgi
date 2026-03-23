import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { SilgiError } from '#src/core/error'
import { silgi } from '#src/silgi'

describe('createCaller', () => {
  // ── Setup ──

  const authGuard = (ctx: Record<string, unknown>) => {
    const token = ctx.token as string | undefined
    if (token !== 'valid') throw new SilgiError('UNAUTHORIZED')
    return { user: { id: 1, name: 'Admin' } }
  }

  const s = silgi({
    context: () => ({
      db: {
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
      },
    }),
  })

  const appRouter = s.router({
    health: s.$resolve(() => ({ status: 'ok', uptime: 123 })),

    users: {
      list: s
        .$route({ method: 'GET' })
        .$input(z.object({ limit: z.number().min(1).max(100).optional() }))
        .$output(z.object({ users: z.array(z.object({ id: z.number(), name: z.string() })), total: z.number() }))
        .$resolve(({ input, ctx }) => {
          const users = (ctx as any).db.users.slice(0, input.limit ?? 10)
          return { users, total: (ctx as any).db.users.length }
        }),

      get: s
        .$input(z.object({ id: z.number() }))
        .$errors({ NOT_FOUND: 404 })
        .$resolve(({ input, ctx, fail }) => {
          const user = (ctx as any).db.users.find((u: any) => u.id === input.id)
          if (!user) return fail('NOT_FOUND')
          return user
        }),

      create: s
        .$use(s.guard(authGuard))
        .$input(z.object({ name: z.string().min(1) }))
        .$resolve(({ input, ctx }) => {
          const user = { id: Date.now(), name: input.name }
          ;(ctx as any).db.users.push(user)
          return user
        }),

      delete: s
        .$route({ method: 'DELETE' })
        .$input(z.object({ id: z.number() }))
        .$resolve(({ input }) => ({ deleted: input.id })),
    },

    deeply: {
      nested: {
        procedure: s.$input(z.object({ value: z.string() })).$resolve(({ input }) => ({ echo: input.value })),
      },
    },
  })

  // ── Basic calls ──

  it('calls a procedure without input', async () => {
    const caller = s.createCaller(appRouter)
    const result = await caller.health()
    expect(result).toEqual({ status: 'ok', uptime: 123 })
  })

  it('calls nested procedures with input', async () => {
    const caller = s.createCaller(appRouter)
    const result = await caller.users.list({ limit: 1 })
    expect(result.users).toHaveLength(1)
    expect(result.total).toBe(2)
  })

  it('calls deeply nested procedures (3+ levels)', async () => {
    const caller = s.createCaller(appRouter)
    const result = await caller.deeply.nested.procedure({ value: 'hello' })
    expect(result).toEqual({ echo: 'hello' })
  })

  // ── Route methods (GET, DELETE, etc.) ──

  it('finds procedures with GET route method', async () => {
    const caller = s.createCaller(appRouter)
    const result = await caller.users.list({})
    expect(result.total).toBe(2)
  })

  it('finds procedures with DELETE route method', async () => {
    const caller = s.createCaller(appRouter)
    const result = await caller.users.delete({ id: 42 })
    expect(result).toEqual({ deleted: 42 })
  })

  // ── Input validation ──

  it('rejects invalid input (schema min)', async () => {
    const caller = s.createCaller(appRouter)
    await expect(caller.users.list({ limit: 0 })).rejects.toThrow()
  })

  it('rejects wrong input type', async () => {
    const caller = s.createCaller(appRouter)
    await expect(caller.users.get({ id: 'not-a-number' as any })).rejects.toThrow()
  })

  // ── Output validation ──

  it('validates output schema', async () => {
    const caller = s.createCaller(appRouter)
    const result = await caller.users.list({})
    expect(result.users).toBeInstanceOf(Array)
    expect(typeof result.total).toBe('number')
  })

  // ── Typed errors ──

  it('throws SilgiError for typed errors', async () => {
    const caller = s.createCaller(appRouter)
    try {
      await caller.users.get({ id: 999 })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(SilgiError)
      expect((err as SilgiError).code).toBe('NOT_FOUND')
    }
  })

  // ── Not found ──

  it('throws for non-existent procedures', async () => {
    const caller = s.createCaller(appRouter)
    await expect(caller.nonexistent()).rejects.toThrow('Procedure not found')
  })

  it('throws for non-existent nested procedures', async () => {
    const caller = s.createCaller(appRouter)
    await expect(caller.users.nonexistent()).rejects.toThrow('Procedure not found')
  })

  // ── Guards ──

  it('rejects when guard fails (no auth)', async () => {
    const caller = s.createCaller(appRouter)
    await expect(caller.users.create({ name: 'Charlie' })).rejects.toThrow()
  })

  it('passes when guard succeeds via context override', async () => {
    const caller = s.createCaller(appRouter, { contextOverride: { token: 'valid' } })
    const result = await caller.users.create({ name: 'Charlie' })
    expect(result.name).toBe('Charlie')
  })

  // ── Context ──

  it('overrides context', async () => {
    const caller = s.createCaller(appRouter, {
      contextOverride: { db: { users: [{ id: 99, name: 'Override' }] } },
    })
    const result = await caller.users.list({})
    expect(result.users).toEqual([{ id: 99, name: 'Override' }])
  })

  it('merges context override with base context', async () => {
    const caller = s.createCaller(appRouter, { contextOverride: { extra: true } })
    const result = await caller.users.list({})
    expect(result.users).toHaveLength(2)
  })

  it('accepts per-call context', async () => {
    const caller = s.createCaller(appRouter)
    // Without auth token — fails
    await expect(caller.users.create({ name: 'X' })).rejects.toThrow()
    // With per-call context — passes
    const result = await caller.users.create({ name: 'Y' }, { context: { token: 'valid' } })
    expect(result.name).toBe('Y')
  })

  // ── Async context factory ──

  it('works with async context factory', async () => {
    const asyncS = silgi({
      context: async () => {
        await new Promise((r) => setTimeout(r, 1))
        return { fromAsync: true }
      },
    })
    const asyncRouter = asyncS.router({
      check: asyncS.$resolve(({ ctx }) => ({ fromAsync: (ctx as any).fromAsync })),
    })
    const caller = asyncS.createCaller(asyncRouter)
    const result = await caller.check()
    expect(result).toEqual({ fromAsync: true })
  })

  // ── Timeout ──

  it('allows null timeout (no limit)', async () => {
    const caller = s.createCaller(appRouter, { timeout: null })
    const result = await caller.health()
    expect(result.status).toBe('ok')
  })

  it('passes signal to handler', async () => {
    const signalS = silgi({ context: () => ({}) })
    const signalRouter = signalS.router({
      checkSignal: signalS.$resolve(({ signal }) => {
        return { aborted: signal?.aborted ?? false }
      }),
    })
    const caller = signalS.createCaller(signalRouter)
    const controller = new AbortController()
    controller.abort()
    const result = await caller.checkSignal(undefined, { signal: controller.signal })
    expect(result.aborted).toBe(true)
  })

  // ── Isolation ──

  it('callers are isolated', async () => {
    const caller1 = s.createCaller(appRouter, { contextOverride: { db: { users: [{ id: 1, name: 'A' }] } } })
    const caller2 = s.createCaller(appRouter, { contextOverride: { db: { users: [{ id: 2, name: 'B' }] } } })

    const r1 = await caller1.users.list({})
    const r2 = await caller2.users.list({})

    expect(r1.users[0].name).toBe('A')
    expect(r2.users[0].name).toBe('B')
  })

  // ── Proxy safety ──

  it('proxy does not break with symbol access', () => {
    const caller = s.createCaller(appRouter)
    expect((caller as any)[Symbol.iterator]).toBeUndefined()
    expect((caller as any)[Symbol.asyncIterator]).toBeUndefined()
    expect((caller as any)[Symbol.toStringTag]).toBeUndefined()
  })
})
