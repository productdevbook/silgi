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
