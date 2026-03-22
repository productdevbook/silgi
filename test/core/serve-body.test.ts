import { describe, expect, it } from 'vitest'

import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({}) })
const echoRouter = k.router({
  echo: k.$resolve(({ input }) => input),
  hello: k.$resolve(() => 'world'),
})
const handle = k.handler(echoRouter)

describe('handler() — body parsing safety', () => {
  it('returns 400 for malformed JSON body', async () => {
    const res = await handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{broken json',
      }),
    )
    // Should not crash — should return an error response
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
  })

  it('returns 400 for malformed GET ?data= JSON', async () => {
    const res = await handle(new Request('http://localhost/hello?data=%7Bbroken'))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(600)
  })

  it('handles UTF-8 multibyte response correctly', async () => {
    const k2 = silgi({ context: () => ({}) })
    const r = k2.router({
      emoji: k2.$resolve(() => ({ text: 'Merhaba dünya 🌍 日本語' })),
    })
    const h = k2.handler(r)
    const res = await h(new Request('http://localhost/emoji'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.text).toBe('Merhaba dünya 🌍 日本語')
  })

  it('returns 404 for unknown procedure', async () => {
    const res = await handle(new Request('http://localhost/nonexistent'))
    expect(res.status).toBe(404)
  })

  it('handles empty POST body gracefully', async () => {
    const res = await handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    )
    // Should not crash
    expect(res.status).toBeLessThan(600)
  })
})

describe('handler() — passthrough (wildcard catch-all)', () => {
  it('does not consume request body for passthrough routes', async () => {
    const k2 = silgi({
      context: (req) => ({ req }),
    })

    // Simulate an external handler that reads the body itself (like Better Auth)
    const externalHandler = k2
      .$route({ method: '*', path: '/api/auth/**' })
      .$resolve(async ({ ctx }) => {
        const body = await (ctx as any).req.json()
        return new Response(JSON.stringify({ received: body }), {
          headers: { 'content-type': 'application/json' },
        })
      })

    const router = k2.router({ auth: { handler: externalHandler } })
    const handle2 = k2.handler(router)

    const res = await handle2(
      new Request('http://localhost/api/auth/sign-in', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', password: 'secret' }),
      }),
    )

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.received).toEqual({ email: 'test@test.com', password: 'secret' })
  })

  it('passthrough route returns Response directly', async () => {
    const k2 = silgi({ context: () => ({}) })

    const proxy = k2
      .$route({ method: '*', path: '/proxy/**' })
      .$resolve(() => new Response('proxied', { status: 200 }))

    const router = k2.router({ proxy })
    const handle2 = k2.handler(router)

    const res = await handle2(new Request('http://localhost/proxy/some/path'))
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('proxied')
  })

  it('passthrough GET request works without body', async () => {
    const k2 = silgi({
      context: (req) => ({ req }),
    })

    const handler = k2
      .$route({ method: '*', path: '/ext/**' })
      .$resolve(({ ctx }) => {
        const url = new URL((ctx as any).req.url)
        return new Response(JSON.stringify({ path: url.pathname }), {
          headers: { 'content-type': 'application/json' },
        })
      })

    const router = k2.router({ ext: { handler } })
    const handle2 = k2.handler(router)

    const res = await handle2(new Request('http://localhost/ext/hello/world'))
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.path).toBe('/ext/hello/world')
  })
})
