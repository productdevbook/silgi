/**
 * Fastify adapter — real Fastify integration tests.
 */

import Fastify from 'fastify'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'

import { katmanFastify } from '#src/adapters/fastify.ts'
import { MSGPACK_CONTENT_TYPE } from '#src/codec/msgpack.ts'
import { katman } from '#src/katman.ts'

import type { FastifyInstance } from 'fastify'

const k = katman({ context: () => ({ db: true }) })

const appRouter = k.router({
  health: k.query(() => ({ status: 'ok' })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  add: k.mutation(z.object({ a: z.number(), b: z.number() }), ({ input }) => ({ sum: input.a + input.b })),
  users: {
    list: k.query(() => [{ id: 1, name: 'Alice' }]),
  },
})

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify()
  app.register(katmanFastify(appRouter))
  await app.ready()
})

afterAll(() => app?.close())

describe('katmanFastify (real Fastify)', () => {
  it('registers routes for each procedure', () => {
    const routes = app.printRoutes()
    expect(routes).toContain('health')
    expect(routes).toContain('echo')
    expect(routes).toContain('add')
  })

  it('handles no-input query', async () => {
    const res = await app.inject({ method: 'POST', url: '/health' })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.status).toBe('ok')
  })

  it('handles query with JSON input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { msg: 'fastify test' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().echo).toBe('fastify test')
  })

  it('handles mutation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/add',
      payload: { a: 10, b: 32 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sum).toBe(42)
  })

  it('handles nested routes', async () => {
    const res = await app.inject({ method: 'POST', url: '/users/list' })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('Alice')
  })

  it('returns validation error for invalid input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      payload: { wrong: 'field' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('BAD_REQUEST')
  })

  it('returns 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'POST', url: '/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('supports prefix via Fastify register', async () => {
    const prefixed = Fastify()
    prefixed.register(katmanFastify(appRouter), { prefix: '/api' })
    await prefixed.ready()

    const res = await prefixed.inject({ method: 'POST', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json().status).toBe('ok')

    // Without prefix should 404
    const res2 = await prefixed.inject({ method: 'POST', url: '/health' })
    expect(res2.statusCode).toBe(404)

    await prefixed.close()
  })

  it('supports context factory', async () => {
    const withCtx = Fastify()
    withCtx.register(
      katmanFastify(k.router({ whoami: k.query(({ ctx }: any) => ({ fromCtx: ctx.userId })) }), {
        context: () => ({ userId: 42 }),
      }),
    )
    await withCtx.ready()

    const res = await withCtx.inject({ method: 'POST', url: '/whoami' })
    expect(res.json().fromCtx).toBe(42)

    await withCtx.close()
  })

  it('coexists with native Fastify routes', async () => {
    const mixed = Fastify()
    mixed.get('/legacy', async () => ({ type: 'rest' }))
    mixed.register(katmanFastify(appRouter), { prefix: '/rpc' })
    await mixed.ready()

    // Native route
    const r1 = await mixed.inject({ method: 'GET', url: '/legacy' })
    expect(r1.json().type).toBe('rest')

    // Katman route
    const r2 = await mixed.inject({ method: 'POST', url: '/rpc/health' })
    expect(r2.json().status).toBe('ok')

    await mixed.close()
  })

  it('responds with msgpack when Accept header set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/health',
      headers: { accept: MSGPACK_CONTENT_TYPE },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe(MSGPACK_CONTENT_TYPE)
  })
})
