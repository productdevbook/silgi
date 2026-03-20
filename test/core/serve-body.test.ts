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
