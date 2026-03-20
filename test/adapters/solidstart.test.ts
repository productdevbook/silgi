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

describe('silgiSolidStart() — real Request/Response', () => {
  it('handles real Fetch API requests', async () => {
    const { silgiSolidStart } = await import('#src/adapters/solidstart.ts')
    const handler = silgiSolidStart(testRouter, { prefix: '/api/rpc' })

    const r1 = await handler({
      request: new Request('http://localhost/api/rpc/health', { method: 'POST' }),
    })
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ status: 'ok' })
  })
})
