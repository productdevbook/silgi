import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { katman, KatmanError } from '#src/katman.ts'

const k = katman({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.query(() => ({ status: 'ok' })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ hello: input.name })),
  fail: k.query(() => {
    throw new KatmanError('NOT_FOUND', { message: 'nope' })
  }),
})

describe('handler() — Fetch API baseline', () => {
  it('handles all operations', async () => {
    const handle = k.handler(testRouter)

    const r1 = await handle(new Request('http://localhost/health', { method: 'POST' }))
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ status: 'ok' })

    const r2 = await handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 'handler' }),
      }),
    )
    expect(await r2.json()).toEqual({ echo: 'handler' })

    const r3 = await handle(new Request('http://localhost/fail', { method: 'POST' }))
    expect(r3.status).toBe(404)
  })
})
