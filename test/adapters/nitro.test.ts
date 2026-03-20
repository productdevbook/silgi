import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgi, SilgiError } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ hello: input.name })),
  fail: k.$resolve(() => {
    throw new SilgiError('NOT_FOUND', { message: 'nope' })
  }),
})

describe('silgiH3() — real NitroEvent', () => {
  it('handles FS routing with path param', async () => {
    const { silgiH3 } = await import('#src/adapters/h3.ts')
    const handler = silgiH3(testRouter)

    const event = {
      method: 'POST',
      url: new URL('http://localhost/rpc/health'),
      path: '/rpc/health',
      req: {
        method: 'POST',
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(''),
      },
      res: { headers: new Headers() },
      context: { params: { path: 'health' } },
    }

    const result = await handler(event as any)
    expect(result).toEqual({ status: 'ok' })
  })

  it('handles prefix mode with body', async () => {
    const { silgiH3 } = await import('#src/adapters/h3.ts')
    const handler = silgiH3(testRouter, { prefix: '/rpc' })

    const event = {
      method: 'POST',
      url: new URL('http://localhost/rpc/echo'),
      path: '/rpc/echo',
      req: {
        method: 'POST',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ msg: 'nitro' }),
        text: () => Promise.resolve(JSON.stringify({ msg: 'nitro' })),
      },
      res: { headers: new Headers() },
      context: { params: {} },
    }

    const result = await handler(event as any)
    expect(result).toEqual({ echo: 'nitro' })
  })

  it('returns NOT_FOUND for unknown procedures', async () => {
    const { silgiH3 } = await import('#src/adapters/h3.ts')
    const handler = silgiH3(testRouter)

    const event = {
      method: 'POST',
      url: new URL('http://localhost/nope'),
      path: '/nope',
      req: {
        method: 'POST',
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(''),
      },
      res: { headers: new Headers() },
      context: { params: { path: 'nope' } },
    }

    const result = (await handler(event as any)) as any
    expect(result.code).toBe('NOT_FOUND')
  })

  it('passes context from Nitro event', async () => {
    const { silgiH3 } = await import('#src/adapters/h3.ts')
    const ctxRouter = k.router({
      whoami: k.$resolve(({ ctx }) => ({ user: (ctx as any).user })),
    })
    const handler = silgiH3(ctxRouter, {
      context: (event: any) => ({ user: event.context.auth }),
    })

    const event = {
      method: 'POST',
      url: new URL('http://localhost/whoami'),
      path: '/whoami',
      req: {
        method: 'POST',
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(''),
      },
      res: { headers: new Headers() },
      context: { params: { path: 'whoami' }, auth: 'Alice' },
    }

    const result = await handler(event as any)
    expect(result).toEqual({ user: 'Alice' })
  })

  it('handles validation errors', async () => {
    const { silgiH3 } = await import('#src/adapters/h3.ts')
    const handler = silgiH3(testRouter, { prefix: '/rpc' })

    const event = {
      method: 'POST',
      url: new URL('http://localhost/rpc/echo'),
      path: '/rpc/echo',
      req: {
        method: 'POST',
        headers: new Headers(),
        json: () => Promise.resolve({ wrong: 'field' }),
        text: () => Promise.resolve(''),
      },
      res: { headers: new Headers() },
      context: { params: {} },
    }

    const result = (await handler(event as any)) as any
    expect(result.code).toBe('BAD_REQUEST')
    expect(result.status).toBe(400)
  })

  it('handles GET with query params', async () => {
    const { silgiH3 } = await import('#src/adapters/h3.ts')
    const handler = silgiH3(testRouter, { prefix: '/rpc' })

    const event = {
      method: 'GET',
      url: new URL('http://localhost/rpc/echo?data=' + encodeURIComponent(JSON.stringify({ msg: 'query' }))),
      path: '/rpc/echo',
      req: {
        method: 'GET',
        headers: new Headers(),
        json: () => Promise.reject(new Error('no body')),
        text: () => Promise.resolve(''),
      },
      res: { headers: new Headers() },
      context: { params: {} },
    }

    const result = await handler(event as any)
    expect(result).toEqual({ echo: 'query' })
  })
})
