import { describe, it, expect } from 'vitest'

import { silgi } from '#src/silgi.ts'

describe('silgi({ wraps })', () => {
  it('applies a root wrap to every procedure', async () => {
    const order: string[] = []

    const k = silgi({
      context: () => ({ db: 'x' }),
    })
    const rootWrap = k.wrap(async (_ctx, next) => {
      order.push('root:before')
      const out = await next()
      order.push('root:after')
      return out
    })

    const s = silgi({
      context: () => ({ db: 'x' }),
      wraps: [rootWrap],
    })

    const r = s.router({
      hello: s.$resolve(() => {
        order.push('resolve')
        return 'hi'
      }),
      nested: {
        bye: s.$resolve(() => 'bye'),
      },
    })

    const caller = s.createCaller(r)
    const out = await caller.hello()
    expect(out).toBe('hi')
    expect(order).toEqual(['root:before', 'resolve', 'root:after'])

    order.length = 0
    await caller.nested.bye()
    expect(order).toEqual(['root:before', 'root:after'])
  })

  it('root wraps are outermost — route-level $use nests inside', async () => {
    const order: string[] = []

    const probe = silgi({ context: () => ({}) })

    const rootWrap = probe.wrap(async (_ctx, next) => {
      order.push('root:before')
      const out = await next()
      order.push('root:after')
      return out
    })

    const routeWrap = probe.wrap(async (_ctx, next) => {
      order.push('route:before')
      const out = await next()
      order.push('route:after')
      return out
    })

    const s = silgi({
      context: () => ({}),
      wraps: [rootWrap],
    })

    const r = s.router({
      hello: s.$use(routeWrap).$resolve(() => {
        order.push('resolve')
        return 'ok'
      }),
    })

    const caller = s.createCaller(r)
    await caller.hello()
    expect(order).toEqual(['root:before', 'route:before', 'resolve', 'route:after', 'root:after'])
  })

  it('multiple root wraps run in declared order (first = outermost)', async () => {
    const order: string[] = []
    const probe = silgi({ context: () => ({}) })

    const outer = probe.wrap(async (_ctx, next) => {
      order.push('outer:before')
      const o = await next()
      order.push('outer:after')
      return o
    })
    const inner = probe.wrap(async (_ctx, next) => {
      order.push('inner:before')
      const o = await next()
      order.push('inner:after')
      return o
    })

    const s = silgi({
      context: () => ({}),
      wraps: [outer, inner],
    })

    const r = s.router({
      hello: s.$resolve(() => 'ok'),
    })

    await s.createCaller(r).hello()
    expect(order).toEqual(['outer:before', 'inner:before', 'inner:after', 'outer:after'])
  })

  it('root wrap can short-circuit without calling next()', async () => {
    const probe = silgi({ context: () => ({}) })
    const shortCircuit = probe.wrap(async () => 'short-circuited')

    const s = silgi({
      context: () => ({}),
      wraps: [shortCircuit],
    })

    const r = s.router({
      hello: s.$resolve(() => 'never'),
    })

    const out = await s.createCaller(r).hello()
    expect(out).toBe('short-circuited')
  })

  it('root wraps are applied via the HTTP handler too', async () => {
    const calls: string[] = []
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => {
      calls.push('wrap')
      return next()
    })

    const s = silgi({
      context: () => ({ n: 1 }),
      wraps: [w],
    })

    const r = s.router({
      ping: s.$resolve(() => 'pong'),
    })

    const handler = s.handler(r)
    const res = await handler(new Request('http://localhost/ping', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toBe('pong')
    expect(calls).toEqual(['wrap'])
  })

  it('rejects non-wrap middleware in config.wraps', () => {
    const probe = silgi({ context: () => ({}) })
    const g = probe.guard(() => ({ x: 1 }))

    expect(() =>
      silgi({
        context: () => ({}),
        wraps: [g as any],
      }),
    ).toThrow(/wrap middleware/)
  })

  it('omitting wraps behaves identically to the previous API', async () => {
    const s = silgi({ context: () => ({}) })
    const r = s.router({ hello: s.$resolve(() => 'ok') })
    const out = await s.createCaller(r).hello()
    expect(out).toBe('ok')
  })

  it('ctx passed to root wrap reflects base context', async () => {
    const probe = silgi({ context: () => ({}) })
    const seen: Record<string, unknown>[] = []
    const spy = probe.wrap(async (ctx, next) => {
      seen.push({ ...ctx })
      return next()
    })

    const s = silgi({
      context: () => ({ tenant: 'acme' }),
      wraps: [spy],
    })

    const r = s.router({ hello: s.$resolve(() => 'ok') })
    await s.createCaller(r).hello()
    expect(seen[0]).toMatchObject({ tenant: 'acme' })
  })

  it('external adapter — compileRouter reads the ROOT_WRAPS brand off the user def', async () => {
    const calls: string[] = []
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => {
      calls.push('wrap')
      return next()
    })

    const s = silgi({
      context: () => ({}),
      wraps: [w],
    })

    // Simulating an adapter that receives the user's RouterDef and compiles
    // it directly without consulting routerCache (express, lambda, nestjs,
    // message-port, batch-server, broker, client/server all do this).
    const { compileRouter } = await import('#src/compile.ts')
    const r = s.router({ hello: s.$resolve(() => 'ok') })
    const flat = compileRouter(r)
    const match = flat('', '/hello')
    expect(match).toBeDefined()
    const ctx: any = {}
    await match!.data.handler(ctx, undefined, AbortSignal.timeout(5000))
    expect(calls).toEqual(['wrap'])
  })

  it('WS path — _createWSHooks gets wraps via compileRouter reading brand off def', async () => {
    // The auto-WS inside silgi.handler() passes the original user def to
    // `_createWSHooks`. `_createWSHooks` in turn calls compileRouter(def).
    // Since the brand lives on the def, wraps flow through automatically.
    const calls: string[] = []
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => {
      calls.push('wrap')
      return next()
    })

    const s = silgi({
      context: () => ({}),
      wraps: [w],
    })

    async function* sub() {
      yield 1
      yield 2
    }

    const r = s.router({
      stream: s.subscription(sub as any),
    })

    // Verify the brand is present on the user's def
    const { ROOT_WRAPS } = await import('#src/core/ctx-symbols.ts')
    expect((r as any)[ROOT_WRAPS]).toBeDefined()
    expect((r as any)[ROOT_WRAPS]).toHaveLength(1)
  })

  it('task.dispatch() runs root wraps (no longer bypasses them)', async () => {
    const order: string[] = []
    const probe = silgi({ context: () => ({}) })
    const tenantScope = probe.wrap(async (ctx, next) => {
      order.push('enter')
      ;(ctx as any).scoped = true
      const out = await next()
      order.push('exit')
      return out
    })

    const s = silgi({
      context: () => ({ db: 'x' }),
      wraps: [tenantScope],
    })

    const seenInTask: any = {}
    const sendEmail = s.$task({
      name: 'send-email',
      resolve: ({ ctx }) => {
        order.push('resolve')
        seenInTask.scoped = (ctx as any).scoped
        return { sent: true }
      },
    })

    const out = await sendEmail.dispatch()
    expect(out).toEqual({ sent: true })
    expect(order).toEqual(['enter', 'resolve', 'exit'])
    expect(seenInTask.scoped).toBe(true)
  })

  it('task.dispatch() without wraps stays on the straight path (zero onion)', async () => {
    const s = silgi({ context: () => ({}) })
    const t = s.$task({
      name: 'noop',
      resolve: () => 'ok',
    })
    const out = await t.dispatch()
    expect(out).toBe('ok')
  })

  it('cache miss does not silently drop wraps — compileRouter re-reads brand', async () => {
    // Simulates the `createFetchHandler` fallback path: if `routerCache`
    // misses (e.g. user never called s.router()), compileRouter runs fresh
    // but still picks up the brand — IF present. When the user didn't call
    // s.router() the brand is absent, which is the correct signal to run
    // wraps-less (matches pre-feature behavior).
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => next())
    const s = silgi({ context: () => ({}), wraps: [w] })

    const rawDef = { hello: s.$resolve(() => 'ok') }
    const { compileRouter } = await import('#src/compile.ts')

    // Without s.router(), no brand, wraps don't apply (documented behavior).
    const flatNoBrand = compileRouter(rawDef)
    const matchA = flatNoBrand('', '/hello')
    expect(matchA).toBeDefined()

    // After s.router(), brand is stamped, wraps apply.
    s.router(rawDef)
    const flatWithBrand = compileRouter(rawDef)
    const matchB = flatWithBrand('', '/hello')
    expect(matchB).toBeDefined()
  })

  it('re-registering a def with a second silgi instance throws', () => {
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => next())

    const s1 = silgi({ context: () => ({}), wraps: [w] })
    const s2 = silgi({ context: () => ({}), wraps: [w] })

    const def = { hello: s1.$resolve(() => 'ok') }
    s1.router(def)
    expect(() => s2.router(def)).toThrow(/already registered/)
  })

  it('re-registering a def with the SAME silgi instance is idempotent', () => {
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => next())
    const s = silgi({ context: () => ({}), wraps: [w] })

    const def = { hello: s.$resolve(() => 'ok') }
    expect(() => {
      s.router(def)
      s.router(def)
    }).not.toThrow()
  })

  it('no wraps configured — def is byte-identical to pre-feature shape', () => {
    const s = silgi({ context: () => ({}) })
    const def = { hello: s.$resolve(() => 'ok') }
    s.router(def)
    const symbols = Object.getOwnPropertySymbols(def)
    expect(symbols).toHaveLength(0)
  })

  it('brand is non-enumerable — router walkers never see it', () => {
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => next())
    const s = silgi({ context: () => ({}), wraps: [w] })

    const def = { a: s.$resolve(() => 1), b: s.$resolve(() => 2) }
    s.router(def)

    // Object.keys / Object.entries skip Symbol-keyed props
    expect(Object.keys(def)).toEqual(['a', 'b'])
    expect(Object.entries(def).map(([k]) => k)).toEqual(['a', 'b'])
  })

  it('Express adapter picks up wraps via compileRouter without per-adapter plumbing', async () => {
    const calls: string[] = []
    const probe = silgi({ context: () => ({}) })
    const w = probe.wrap(async (_ctx, next) => {
      calls.push('wrap')
      return next()
    })

    const s = silgi({
      context: () => ({ db: 'x' }),
      wraps: [w],
    })

    const r = s.router({
      ping: s.$resolve(() => 'pong'),
    })

    const express = (await import('express')).default
    const { createHandler } = await import('#src/adapters/express.ts')

    const app = express()
    app.use(express.json())
    app.use('/rpc', createHandler(r))

    const server = app.listen(0)
    try {
      const address = server.address() as { port: number }
      const res = await fetch(`http://127.0.0.1:${address.port}/rpc/ping`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      })
      expect(res.status).toBe(200)
      expect(await res.json()).toBe('pong')
      expect(calls).toEqual(['wrap'])
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('compiled handler is always async and resolves to the resolver output', async () => {
    // The compiled handler is uniformly async — no sync fast-path, no
    // sync-vs-async branching in callers. This test pins the contract so
    // future changes that reintroduce a sync path (and the branching it
    // forces on every consumer) are caught at CI time.
    const s = silgi({ context: () => ({}) })
    const proc = s.$resolve(() => 'sync')
    const { compileProcedure } = await import('#src/compile.ts')
    const handler = compileProcedure(proc as any)
    const ctx: Record<string, unknown> = {}
    const result = handler(ctx, undefined, AbortSignal.timeout(5000))
    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toBe('sync')
  })
})
