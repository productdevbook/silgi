/**
 * srvx integration test — verifies serve() works with the srvx universal server.
 */

import { describe, it, expect, afterAll } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'

const s = silgi({ context: () => ({ db: 'test' }) })

const appRouter = s.router({
  health: s.$resolve(() => ({ status: 'ok' })),
  echo: s
    .$input(z.object({ msg: z.string() }))
    .$resolve(({ input }) => ({ echo: input.msg })),
})

// Use handler() directly with srvx — same thing serve() does internally
import { serve } from 'srvx'

const server = await serve({
  port: 0,
  fetch: s.handler(appRouter),
})

const serverUrl = server.url!.replace(/\/$/, '')

afterAll(async () => {
  await server.close()
})

describe('silgi + srvx universal server', () => {
  it('POST /health — no-input', async () => {
    const res = await fetch(`${serverUrl}/health`, { method: 'POST' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('POST /echo — with JSON body', async () => {
    const res = await fetch(`${serverUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'srvx-test' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.echo).toBe('srvx-test')
  })

  it('POST /unknown — 404', async () => {
    const res = await fetch(`${serverUrl}/unknown`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST /echo — validation error', async () => {
    const res = await fetch(`${serverUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: 'field' }),
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('BAD_REQUEST')
  })

  it('POST /echo — msgpack accept returns msgpack', async () => {
    const res = await fetch(`${serverUrl}/echo`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'accept': 'application/x-msgpack',
      },
      body: JSON.stringify({ msg: 'binary' }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-msgpack')
  })

  it('handler with scalar option serves /openapi.json', async () => {
    const scalarHandler = s.handler(appRouter, { scalar: true })
    const scalarServer = await serve({ port: 0, fetch: scalarHandler })
    const scalarUrl = scalarServer.url!.replace(/\/$/, '')

    const res = await fetch(`${scalarUrl}/openapi.json`)
    expect(res.status).toBe(200)
    const spec = await res.json()
    expect(spec.openapi).toBe('3.1.0')

    const refRes = await fetch(`${scalarUrl}/reference`)
    expect(refRes.status).toBe(200)
    expect(refRes.headers.get('content-type')).toBe('text/html')

    await scalarServer.close()
  })
})
