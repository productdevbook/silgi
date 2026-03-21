import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { SilgiError } from '#src/core/error.ts'
import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ hello: input.name })),
  fail: k.$resolve(() => {
    throw new SilgiError('NOT_FOUND', { message: 'nope' })
  }),
})

describe('silgiRemix() — real Request/Response', () => {
  it('handles real Fetch API requests', async () => {
    const { silgiRemix } = await import('#src/adapters/remix.ts')
    const handler = silgiRemix(testRouter, { prefix: '/rpc' })

    const r1 = await handler({
      request: new Request('http://localhost/rpc/health', { method: 'POST' }),
      params: {},
    })
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ status: 'ok' })

    const r2 = await handler({
      request: new Request('http://localhost/rpc/greet', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Remix' }),
      }),
      params: {},
    })
    expect(await r2.json()).toEqual({ hello: 'Remix' })
  })
})
