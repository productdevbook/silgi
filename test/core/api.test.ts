import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

import { compileProcedure } from '#src/compile.ts'
import { KatmanError } from '#src/core/error.ts'
import { katman } from '#src/katman.ts'

// ── Setup ───────────────────────────────────────────

const k = katman({
  context: (req: Request) => ({
    headers: Object.fromEntries(req.headers) as Record<string, string>,
    db: { users: [{ id: 1, name: 'Alice', email: 'alice@test.com' }] },
  }),
})

// ── Guard / Wrap Tests ──────────────────────────────

describe('guard()', () => {
  it('creates a guard middleware def', () => {
    const auth = k.guard(async (ctx) => {
      return { user: { id: 1, name: 'admin' } }
    })
    expect(auth.kind).toBe('guard')
    expect(typeof auth.fn).toBe('function')
  })

  it('sync guard merges context', async () => {
    const enrichIp = k.guard((ctx) => ({ ip: '1.2.3.4' }))
    const proc = k.$use(enrichIp).$resolve(async ({ ctx }) => (ctx as any).ip)

    const pipeline = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await pipeline(ctx, undefined, AbortSignal.timeout(5000))
    expect(result).toBe('1.2.3.4')
    expect(ctx.ip).toBe('1.2.3.4') // mutated in place via Object.assign
  })

  it('async guard merges context', async () => {
    const auth = k.guard(async () => ({ user: 'admin' }))
    const proc = k.$use(auth).$resolve(async ({ ctx }) => (ctx as any).user)

    const pipeline = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await pipeline(ctx, undefined, AbortSignal.timeout(5000))
    expect(result).toBe('admin')
  })

  it('void guard (mutation-style) works', async () => {
    const enrichIp = k.guard((ctx: any) => {
      ctx.ip = '1.2.3.4' // direct mutation, no return
    })
    const proc = k.$use(enrichIp).$resolve(async ({ ctx }) => (ctx as any).ip)

    const pipeline = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await pipeline(ctx, undefined, AbortSignal.timeout(5000))
    expect(result).toBe('1.2.3.4')
  })

  it('only merges plain objects, not class instances', async () => {
    const badGuard = k.guard(() => new Date() as any)
    const proc = k.$use(badGuard).$resolve(async ({ ctx }) => Object.keys(ctx))

    const pipeline = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = await pipeline(ctx, undefined, AbortSignal.timeout(5000))
    // Date instance should NOT be merged
    expect(result).toEqual([])
  })

  it('multiple guards chain context', async () => {
    const addA = k.guard(() => ({ a: 1 }))
    const addB = k.guard(() => ({ b: 2 }))
    const addC = k.guard(async () => ({ c: 3 }))

    const proc = k.$use(addA, addB, addC).$resolve(async ({ ctx }) => ({
      a: (ctx as any).a,
      b: (ctx as any).b,
      c: (ctx as any).c,
    }))

    const pipeline = compileProcedure(proc)
    const ctx: Record<string, unknown> = {}
    const result = (await pipeline(ctx, undefined, AbortSignal.timeout(5000))) as any
    expect(result).toEqual({ a: 1, b: 2, c: 3 })
  })
})

describe('wrap()', () => {
  it('creates a wrap middleware def', () => {
    const timing = k.wrap(async (ctx, next) => {
      const result = await next()
      return result
    })
    expect(timing.kind).toBe('wrap')
  })

  it('wrap runs before and after handler', async () => {
    const order: string[] = []
    const mw = k.wrap(async (ctx, next) => {
      order.push('before')
      const result = await next()
      order.push('after')
      return result
    })

    const proc = k.$use(mw).$resolve(async () => {
      order.push('handler')
      return 'ok'
    })

    const pipeline = compileProcedure(proc)
    await pipeline({}, undefined, AbortSignal.timeout(5000))
    expect(order).toEqual(['before', 'handler', 'after'])
  })

  it('guards run before wraps', async () => {
    const order: string[] = []
    const g = k.guard(() => {
      order.push('guard')
      return { x: 1 }
    })
    const w = k.wrap(async (ctx, next) => {
      order.push('wrap')
      return next()
    })

    const proc = k.$use(g, w).$resolve(async () => {
      order.push('handler')
      return 'ok'
    })

    const pipeline = compileProcedure(proc)
    await pipeline({}, undefined, AbortSignal.timeout(5000))
    expect(order).toEqual(['guard', 'wrap', 'handler'])
  })
})

// ── Procedure Factory Tests ────────────────────────

describe('query() / mutation() / subscription()', () => {
  it('short form: query(resolve)', () => {
    const proc = k.$resolve(async () => 'hello')
    expect(proc.type).toBe('query')
    expect(proc.input).toBeNull()
    expect(proc.resolve).toBeDefined()
  })

  it('short form: query(input, resolve)', () => {
    const proc = k
      .$input(z.object({ name: z.string() }) as any)
      .$resolve(async ({ input }: any) => `hello ${input.name}`)
    expect(proc.type).toBe('query')
    expect(proc.input).toBeDefined()
  })

  it('builder form: $use(...).$input(...).$errors(...).$resolve(...)', () => {
    const auth = k.guard(async () => ({ user: 'admin' }))
    const proc = k
      .$use(auth)
      .$input(z.object({ name: z.string() }) as any)
      .$errors({ CONFLICT: 409 })
      .$resolve(async ({ input, fail }: any) => {
        return { id: 1, name: input.name }
      })
    expect(proc.type).toBe('query')
    expect(proc.errors).toEqual({ CONFLICT: 409 })
    expect(proc.use).toHaveLength(1)
  })

  it('subscription creates correct type', () => {
    const proc = k.subscription(async function* () {
      yield { tick: 1 }
    })
    expect(proc.type).toBe('subscription')
  })

  it('all procedures have same 8-property shape', () => {
    const q = k.$resolve(async () => 'q')
    const m = k.$resolve(async () => 'm')
    const s = k.subscription(async function* () {
      yield 1
    })

    const keys = ['type', 'input', 'output', 'errors', 'use', 'resolve', 'route', 'meta']
    expect(Object.keys(q).toSorted()).toEqual(keys.toSorted())
    expect(Object.keys(m).toSorted()).toEqual(keys.toSorted())
    expect(Object.keys(s).toSorted()).toEqual(keys.toSorted())
  })
})

// ── fail() Tests ────────────────────────────────────

describe('fail()', () => {
  it('throws KatmanError with defined=true', async () => {
    const proc = k.$errors({ CONFLICT: 409 }).$resolve(async ({ fail }: any) => {
      fail('CONFLICT')
    })

    const pipeline = compileProcedure(proc)
    await expect(pipeline({}, undefined, AbortSignal.timeout(5000))).rejects.toMatchObject({
      code: 'CONFLICT',
      status: 409,
      defined: true,
    })
  })

  it('fail with data', async () => {
    const proc = k
      .$errors({ INVALID: { status: 422, message: 'Validation failed' } })
      .$resolve(async ({ fail }: any) => {
        fail('INVALID', { field: 'email' })
      })

    const pipeline = compileProcedure(proc)
    await expect(pipeline({}, undefined, AbortSignal.timeout(5000))).rejects.toMatchObject({
      code: 'INVALID',
      status: 422,
      data: { field: 'email' },
    })
  })

  it('fail on procedure without errors still throws (defined=false)', async () => {
    const proc = k.$resolve(async ({ fail }: any) => {
      fail('RANDOM')
    })

    const pipeline = compileProcedure(proc)
    await expect(pipeline({}, undefined, AbortSignal.timeout(5000))).rejects.toMatchObject({
      code: 'RANDOM',
      defined: false,
    })
  })
})

// ── Validation Tests ────────────────────────────────

describe('input/output validation', () => {
  it('validates input schema', async () => {
    const proc = k.$input(z.object({ name: z.string() }) as any).$resolve(async ({ input }: any) => input.name)

    const pipeline = compileProcedure(proc)

    // Valid
    expect(await pipeline({}, { name: 'Alice' }, AbortSignal.timeout(5000))).toBe('Alice')

    // Invalid
    await expect(pipeline({}, { name: 123 }, AbortSignal.timeout(5000))).rejects.toThrow()
  })

  it('validates output schema', async () => {
    const proc = k.$output(z.object({ id: z.number() }) as any).$resolve(async () => ({ id: 'not-a-number' }))

    const pipeline = compileProcedure(proc)
    await expect(pipeline({}, undefined, AbortSignal.timeout(5000))).rejects.toThrow()
  })
})

// ── Router Tests ────────────────────────────────────

describe('router()', () => {
  it('auto-assigns paths', () => {
    const router = k.router({
      health: k.$resolve(async () => 'ok'),
      users: {
        list: k.$resolve(async () => []),
        create: k.$resolve(async () => ({})),
      },
    })

    expect((router.health as any).route.path).toBe('/health')
    expect((router.users.list as any).route.path).toBe('/users/list')
    expect((router.users.create as any).route.path).toBe('/users/create')
  })
})

// ── Handler (Fetch) Tests ───────────────────────────

describe('handler()', () => {
  const router = k.router({
    health: k.$resolve(async () => ({ status: 'ok' })),
    greet: k.$input(z.object({ name: z.string() }) as any).$resolve(async ({ input }: any) => ({
      message: `Hello, ${input.name}!`,
    })),
    fail: k.$errors({ FORBIDDEN: 403 }).$resolve(async ({ fail }: any) => {
      fail('FORBIDDEN')
    }),
  })

  const handle = k.handler(router)

  it('handles a successful request', async () => {
    const req = new Request('http://localhost/health', { method: 'POST' })
    const res = await handle(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('handles request with input', async () => {
    const req = new Request('http://localhost/greet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'World' }),
    })
    const res = await handle(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.message).toBe('Hello, World!')
  })

  it('returns 404 for unknown path', async () => {
    const req = new Request('http://localhost/nonexistent', { method: 'POST' })
    const res = await handle(req)
    expect(res.status).toBe(404)
  })

  it('returns typed error from fail()', async () => {
    const req = new Request('http://localhost/fail', { method: 'POST' })
    const res = await handle(req)
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.code).toBe('FORBIDDEN')
    expect(body.defined).toBe(true)
  })

  it('returns 400 for validation errors', async () => {
    const req = new Request('http://localhost/greet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 123 }),
    })
    const res = await handle(req)
    expect(res.status).toBe(400)
  })
})

// ── Full E2E Test ───────────────────────────────────

describe('E2E: Full CRUD', () => {
  const db = [
    { id: 1, name: 'Alice', email: 'alice@test.com' },
    { id: 2, name: 'Bob', email: 'bob@test.com' },
  ]

  const k2 = katman({
    context: (req: Request) => ({
      headers: Object.fromEntries(req.headers) as Record<string, string>,
    }),
  })

  const auth = k2.guard(async (ctx) => {
    if (ctx.headers.authorization !== 'Bearer secret') {
      throw new KatmanError('UNAUTHORIZED')
    }
    return { userId: 1 }
  })

  const router = k2.router({
    users: {
      list: k2
        .$input(z.object({ limit: z.number().optional() }) as any)
        .$resolve(async ({ input }: any) => db.slice(0, input?.limit ?? 10)),
      create: k2
        .$use(auth)
        .$input(z.object({ name: z.string(), email: z.string() }) as any)
        .$errors({ CONFLICT: 409 })
        .$resolve(async ({ input, ctx, fail }: any) => {
          if (db.some((u) => u.email === input.email)) fail('CONFLICT')
          const user = { id: db.length + 1, ...input }
          db.push(user)
          return user
        }),
    },
  })

  const handle = k2.handler(router)

  it('lists users', async () => {
    const res = await handle(
      new Request('http://localhost/users/list', {
        method: 'POST',
        body: JSON.stringify({ limit: 1 }),
      }),
    )
    const body = await res.json()
    expect(body).toHaveLength(1)
    expect(body[0].name).toBe('Alice')
  })

  it('creates user with auth', async () => {
    const res = await handle(
      new Request('http://localhost/users/create', {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Charlie', email: 'charlie@test.com' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.name).toBe('Charlie')
  })

  it('rejects without auth', async () => {
    const res = await handle(
      new Request('http://localhost/users/create', {
        method: 'POST',
        body: JSON.stringify({ name: 'X', email: 'x@test.com' }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects duplicate email', async () => {
    const res = await handle(
      new Request('http://localhost/users/create', {
        method: 'POST',
        headers: { authorization: 'Bearer secret', 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alice2', email: 'alice@test.com' }),
      }),
    )
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('CONFLICT')
    expect(body.defined).toBe(true)
  })
})

// ── URL Params Tests ────────────────────────────────

describe('URL params from route patterns', () => {
  const k3 = katman({
    context: () => ({}),
  })

  it('surfaces :id param from route pattern to resolve context', async () => {
    const router = k3.router({
      users: {
        byId: k3.$route({ path: '/users/:id', method: 'GET' }).$resolve(async ({ params }: any) => {
          return { userId: params.id }
        }),
      },
    })
    const handle = k3.handler(router)

    const res = await handle(new Request('http://localhost/users/123', { method: 'GET' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('123')
  })

  it('surfaces multiple params from route pattern', async () => {
    const router = k3.router({
      posts: {
        byUserAndPost: k3
          .$route({ path: '/users/:userId/posts/:postId', method: 'GET' })
          .$resolve(async ({ params }: any) => {
            return { userId: params.userId, postId: params.postId }
          }),
      },
    })
    const handle = k3.handler(router)

    const res = await handle(new Request('http://localhost/users/42/posts/99', { method: 'GET' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.userId).toBe('42')
    expect(body.postId).toBe('99')
  })

  it('provides empty params object for static routes', async () => {
    const router = k3.router({
      health: k3.$resolve(async ({ params }: any) => {
        return { hasParams: Object.keys(params).length > 0 }
      }),
    })
    const handle = k3.handler(router)

    const res = await handle(new Request('http://localhost/health', { method: 'POST' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hasParams).toBe(false)
  })

  it('params work with POST method and input', async () => {
    const router = k3.router({
      users: {
        update: k3
          .$route({ path: '/users/:id', method: 'POST' })
          .$input(z.object({ name: z.string() }) as any)
          .$resolve(async ({ params, input }: any) => {
            return { id: params.id, name: input.name }
          }),
      },
    })
    const handle = k3.handler(router)

    const res = await handle(
      new Request('http://localhost/users/456', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Updated' }),
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.id).toBe('456')
    expect(body.name).toBe('Updated')
  })
})
