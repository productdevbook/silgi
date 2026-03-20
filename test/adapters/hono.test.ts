import { createServer } from 'node:http'

import { describe, it, expect, afterAll } from 'vitest'
import { z } from 'zod'

import { silgi, SilgiError } from '#src/silgi.ts'

import type { Server } from 'node:http'

const k = silgi({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ hello: input.name })),
  fail: k.$resolve(() => {
    throw new SilgiError('NOT_FOUND', { message: 'nope' })
  }),
})

function listen(server: Server, port: number): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      })
    })
  })
}

async function post(url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, data: await res.json() }
}

describe('silgiHono() — real Hono', () => {
  let url: string
  let close: () => void

  afterAll(() => close?.())

  it('starts and handles requests', async () => {
    const { Hono } = await import('hono')
    const { silgiHono } = await import('#src/adapters/hono.ts')

    const app = new Hono()
    app.all('/rpc/*', silgiHono(testRouter, { prefix: '/rpc' }))

    // Hono has .fetch() — wrap in Node HTTP server
    const server = createServer(async (req, res) => {
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v)
      }
      const body = await new Promise<string>((r) => {
        let b = ''
        req.on('data', (d: Buffer) => {
          b += d
        })
        req.on('end', () => r(b))
      })
      const request = new Request(`http://127.0.0.1:5100${req.url}`, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? body || undefined : undefined,
      })
      const response = await app.fetch(request)
      res.statusCode = response.status
      response.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(await response.text())
    })

    ;({ url, close } = await listen(server, 5100))

    const r1 = await post(`${url}/rpc/health`)
    expect(r1.status).toBe(200)
    expect(r1.data).toEqual({ status: 'ok' })

    const r2 = await post(`${url}/rpc/echo`, { msg: 'hono' })
    expect(r2.status).toBe(200)
    expect(r2.data).toEqual({ echo: 'hono' })

    const r3 = await post(`${url}/rpc/nonexistent`)
    expect(r3.status).toBe(404)
  })
})
