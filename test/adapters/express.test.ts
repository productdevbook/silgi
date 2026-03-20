import { describe, it, expect, afterAll } from 'vitest'
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

async function post(url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json() }
}

describe('katmanExpress() — real Express', () => {
  let url: string
  let close: () => void

  afterAll(() => close?.())

  it('starts and handles requests', async () => {
    const express = (await import('express')).default
    const { katmanExpress } = await import('#src/adapters/express.ts')

    const app = express()
    app.use(express.json())
    app.use('/rpc', katmanExpress(testRouter))

    const server = app.listen(5101, '127.0.0.1')
    url = 'http://127.0.0.1:5101'
    close = () => server.close()

    // Wait for listen
    await new Promise((r) => setTimeout(r, 100))

    const r1 = await post(`${url}/rpc/health`)
    expect(r1.status).toBe(200)
    expect(r1.data).toEqual({ status: 'ok' })

    const r2 = await post(`${url}/rpc/echo`, { msg: 'express' })
    expect(r2.status).toBe(200)
    expect(r2.data).toEqual({ echo: 'express' })

    const r3 = await post(`${url}/rpc/fail`)
    expect(r3.status).toBe(404)
    expect(r3.data.code).toBe('NOT_FOUND')
  })
})
