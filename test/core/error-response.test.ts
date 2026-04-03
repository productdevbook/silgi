import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { SilgiError } from '#src/core/error.ts'
import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({}) })

describe('HTTP error responses', () => {
  it('returns JSON 404 when resolver throws SilgiError NOT_FOUND', async () => {
    const router = k.router({
      users: {
        get: k
          .$route({ method: 'GET', path: '/api/users/:id' })
          .$input(z.object({ id: z.string() }))
          .$resolve(({ input }) => {
            throw new SilgiError('NOT_FOUND', { status: 404, message: `User ${input.id} not found` })
          }),
      },
    })

    const handler = k.handler(router)
    const response = await handler(new Request('http://localhost/api/users/999'))

    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')

    const body = await response.json()
    expect(body.code).toBe('NOT_FOUND')
    expect(body.status).toBe(404)
    expect(body.message).toBe('User 999 not found')
  })

  it('returns JSON 401 when guard throws SilgiError UNAUTHORIZED', async () => {
    const authGuard = k.guard(() => {
      throw new SilgiError('UNAUTHORIZED', { status: 401 })
    })

    const router = k.router({
      secret: k.$use(authGuard).$resolve(() => 'secret'),
    })

    const handler = k.handler(router)
    const response = await handler(new Request('http://localhost/secret', { method: 'POST' }))

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns JSON 409 when using $errors + fail()', async () => {
    const router = k.router({
      users: {
        create: k
          .$input(z.object({ name: z.string() }))
          .$errors({ CONFLICT: { status: 409, message: 'Already exists' } })
          .$resolve(({ fail }) => {
            fail('CONFLICT')
          }),
      },
    })

    const handler = k.handler(router)
    const response = await handler(
      new Request('http://localhost/users/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Alice' }),
      }),
    )

    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body.code).toBe('CONFLICT')
    expect(body.defined).toBe(true)
  })

  it('returns JSON 500 for unhandled errors', async () => {
    const router = k.router({
      crash: k.$resolve(() => {
        throw new Error('Something broke')
      }),
    })

    const handler = k.handler(router)
    const response = await handler(new Request('http://localhost/crash', { method: 'POST' }))

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('returns JSON 400 for input validation errors', async () => {
    const router = k.router({
      users: {
        create: k.$input(z.object({ email: z.string().email() })).$resolve(({ input }) => input),
      },
    })

    const handler = k.handler(router)
    const response = await handler(
      new Request('http://localhost/users/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'not-an-email' }),
      }),
    )

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('404 from resolver is different from 404 procedure-not-found', async () => {
    const router = k.router({
      items: {
        get: k.$resolve(() => {
          throw new SilgiError('NOT_FOUND', { status: 404, message: 'Item not found' })
        }),
      },
    })

    const handler = k.handler(router)

    // Resolver 404 — should return JSON with message
    const res1 = await handler(new Request('http://localhost/items/get', { method: 'POST' }))
    expect(res1.status).toBe(404)
    const body1 = await res1.json()
    expect(body1.message).toBe('Item not found')

    // Procedure-not-found 404 — different message
    const res2 = await handler(new Request('http://localhost/does-not-exist', { method: 'POST' }))
    expect(res2.status).toBe(404)
    const body2 = await res2.json()
    expect(body2.message).toBe('Procedure not found')
  })
})
