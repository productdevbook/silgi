import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
})

describe('bun adapter', () => {
  it('returns a Bun.serve config with defaults', async () => {
    const { createHandler } = await import('#src/adapters/bun.ts')
    const handler = createHandler(testRouter)

    expect(handler.port).toBe(3000)
    expect(handler.hostname).toBe('0.0.0.0')
    expect(typeof handler.fetch).toBe('function')

    const r1 = await handler.fetch(new Request('http://localhost/health', { method: 'POST' }))
    expect(r1.status).toBe(200)
    expect(await r1.json()).toEqual({ status: 'ok' })

    const r2 = await handler.fetch(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 'bun' }),
      }),
    )
    expect(await r2.json()).toEqual({ echo: 'bun' })
  })

  it('respects port and hostname overrides', async () => {
    const { createHandler } = await import('#src/adapters/bun.ts')
    const handler = createHandler(testRouter, { port: 8080, hostname: '127.0.0.1' })

    expect(handler.port).toBe(8080)
    expect(handler.hostname).toBe('127.0.0.1')
  })

  it('forwards scalar option — serves reference under basePath', async () => {
    const { createHandler } = await import('#src/adapters/bun.ts')
    const handler = createHandler(testRouter, { basePath: '/api', scalar: true })

    const spec = await handler.fetch(new Request('http://localhost/api/openapi.json'))
    expect(spec.status).toBe(200)
    expect(spec.headers.get('content-type')).toContain('application/json')

    const ref = await handler.fetch(new Request('http://localhost/api/reference'))
    expect(ref.status).toBe(200)
    expect(ref.headers.get('content-type')).toContain('text/html')

    const health = await handler.fetch(new Request('http://localhost/api/health', { method: 'POST' }))
    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ status: 'ok' })
  })

  it('returns 404 outside basePath when configured', async () => {
    const { createHandler } = await import('#src/adapters/bun.ts')
    const handler = createHandler(testRouter, { basePath: '/api' })

    const miss = await handler.fetch(new Request('http://localhost/health', { method: 'POST' }))
    expect(miss.status).toBe(404)
  })
})
