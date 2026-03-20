import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { katman, KatmanError } from '#src/katman.ts'

const k = katman({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ hello: input.name })),
  fail: k.$resolve(() => {
    throw new KatmanError('NOT_FOUND', { message: 'nope' })
  }),
})

describe('katmanSolidStart() — real Request/Response', () => {
  it('handles real Fetch API requests', async () => {
    const { katmanSolidStart } = await import('#src/adapters/solidstart.ts')
    const handler = katmanSolidStart(testRouter, { prefix: '/api/rpc' })

    const r1 = await handler({
      request: new Request('http://localhost/api/rpc/health', { method: 'POST' }),
    })
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ status: 'ok' })
  })
})
