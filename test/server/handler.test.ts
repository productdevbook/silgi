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

describe('handler() — empty body with content-type headers', () => {
  const handle = k.handler(testRouter)

  it('handles empty body with Content-Type: application/json', async () => {
    const res = await handle(
      new Request('http://localhost/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('handles empty body with Content-Type: application/x-msgpack', async () => {
    const res = await handle(
      new Request('http://localhost/health', {
        method: 'POST',
        headers: { 'content-type': 'application/x-msgpack' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('handles empty body with Content-Type: application/x-devalue+json', async () => {
    const res = await handle(
      new Request('http://localhost/health', {
        method: 'POST',
        headers: { 'content-type': 'application/x-devalue+json' },
      }),
    )
    expect(res.status).toBe(200)
  })

  it('handles empty body with Accept: application/x-msgpack', async () => {
    const res = await handle(
      new Request('http://localhost/health', {
        method: 'POST',
        headers: { accept: 'application/x-msgpack' },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-msgpack')
  })

  it('handles empty body with Accept: application/x-devalue+json', async () => {
    const res = await handle(
      new Request('http://localhost/health', {
        method: 'POST',
        headers: { accept: 'application/x-devalue+json' },
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-devalue+json')
  })
})

describe('handler() — basePath option', () => {
  const handle = k.handler(testRouter, { basePath: '/api' })

  it('routes requests matching the basePath prefix', async () => {
    const res = await handle(new Request('http://localhost/api/health', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('strips prefix and routes with input', async () => {
    const res = await handle(
      new Request('http://localhost/api/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 'prefixed' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ echo: 'prefixed' })
  })

  it('returns 404 for paths not matching the prefix', async () => {
    const res = await handle(new Request('http://localhost/other/health', { method: 'POST' }))
    expect(res.status).toBe(404)
  })

  it('returns 404 for root path without prefix', async () => {
    const res = await handle(new Request('http://localhost/health', { method: 'POST' }))
    expect(res.status).toBe(404)
  })

  it('preserves query string through prefix stripping', async () => {
    const res = await handle(new Request('http://localhost/api/health?foo=bar', { method: 'POST' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('does not match prefix as a substring — /api2/... returns 404', async () => {
    // Boundary check: `/api2/health` must not silently route to `/health`.
    const res = await handle(new Request('http://localhost/api2/health', { method: 'POST' }))
    expect(res.status).toBe(404)
  })
})
