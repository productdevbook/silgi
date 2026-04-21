import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { SilgiError } from '#src/core/error.ts'
import { createFetchHandler } from '#src/core/handler.ts'
import { silgi } from '#src/silgi.ts'

/**
 * Context-release smoke tests.
 *
 * These tests used to drain an internal context pool and verify that
 * the recycled object came back stripped after each request exit
 * path. The pool has been removed — every request now allocates a
 * fresh null-prototype object and the GC reclaims it. That makes the
 * old "pool readback" assertion meaningless, but the *exit paths*
 * themselves still need to be exercised:
 *
 *   - a JSON resolver return
 *   - a passthrough `Response` return
 *   - an async-iterator (SSE) fully consumed
 *   - an async-iterator (SSE) cancelled mid-stream
 *   - a thrown error caught by the error path
 *   - an input-validated resolver
 *
 * Each test just verifies the handler produces the right response
 * without leaking. A regression that, say, throws inside the stream
 * cleanup or fails to flush the error path would land here as a
 * failing status / body assertion instead of a pool-residency check.
 */

const k = silgi({ context: () => ({}) })

const router = k.router({
  json: k.$resolve(() => ({ ok: true })),
  response: k.$resolve(() => new Response('raw', { status: 200 })),
  sse: k.$resolve(async function* () {
    yield { n: 1 }
    yield { n: 2 }
  }),
  fail: k.$resolve(() => {
    throw new SilgiError('BAD_REQUEST', { message: 'nope' })
  }),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
})

const handler = createFetchHandler(router, () => ({}))

describe('request exit paths', () => {
  it('JSON response returns the resolver output', async () => {
    const r = await handler(new Request('http://localhost/json', { method: 'POST' }))
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ ok: true })
  })

  it('passthrough Response is returned as-is', async () => {
    const r = await handler(new Request('http://localhost/response', { method: 'POST' }))
    expect(r.status).toBe(200)
    expect(await r.text()).toBe('raw')
  })

  it('SSE stream can be fully consumed', async () => {
    const r = await handler(new Request('http://localhost/sse', { method: 'POST' }))
    const reader = r.body!.getReader()
    // Drain the stream — success is just not hanging.
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(r.headers.get('content-type')).toMatch(/event-stream/)
  })

  it('SSE stream can be cancelled mid-stream', async () => {
    const r = await handler(new Request('http://localhost/sse', { method: 'POST' }))
    await r.body!.cancel()
    // Success is cancel() resolving without throwing.
  })

  it('thrown SilgiError surfaces with the declared status', async () => {
    const r = await handler(new Request('http://localhost/fail', { method: 'POST' }))
    expect(r.status).toBe(400)
    const body = (await r.json()) as { code: string }
    expect(body.code).toBe('BAD_REQUEST')
  })

  it('input validation + resolver round-trips successfully', async () => {
    const r = await handler(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 'hi' }),
      }),
    )
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ echo: 'hi' })
  })
})
