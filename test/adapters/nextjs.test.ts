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

describe('createHandler() — real Request/Response', () => {
  it('handles real Fetch API requests', async () => {
    const { createHandler } = await import('#src/adapters/nextjs.ts')
    const handler = createHandler(testRouter, { prefix: '/api/rpc' })

    const r1 = await handler(new Request('http://localhost/api/rpc/health', { method: 'POST' }))
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ status: 'ok' })

    const r2 = await handler(
      new Request('http://localhost/api/rpc/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 'nextjs' }),
      }),
    )
    expect(await r2.json()).toEqual({ echo: 'nextjs' })

    const r3 = await handler(new Request('http://localhost/api/rpc/unknown', { method: 'POST' }))
    expect(r3.status).toBe(404)

    const r4 = await handler(new Request('http://localhost/api/rpc/fail', { method: 'POST' }))
    expect(r4.status).toBe(404)
    expect((await r4.json()).code).toBe('NOT_FOUND')
  })
})
