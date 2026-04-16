import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createContext, releaseContext } from '#src/compile.ts'
import { createFetchHandler } from '#src/core/handler.ts'
import { SilgiError } from '#src/core/error.ts'
import { silgi } from '#src/silgi.ts'

/**
 * Drain the internal pool and seed it with a known tagged context. After a
 * request completes, the tagged context should be back in the pool (stripped
 * of its tag), proving `releaseContext` ran exactly once.
 */
function withTaggedCtx(tag: string): { ctx: ReturnType<typeof createContext>; isReleased: () => boolean } {
  // Drain pool — pull until empty.
  while (true) {
    const probe = createContext()
    releaseContext(probe)
    const next = createContext()
    if (next !== probe) {
      releaseContext(next)
      releaseContext(probe)
      // Pool may have been growing; retry drain.
      continue
    }
    releaseContext(probe)
    break
  }

  const ctx = createContext()
  ;(ctx as any).__tag = tag
  releaseContext(ctx)

  return {
    ctx,
    isReleased: () => !('__tag' in ctx),
  }
}

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

describe('pooled context release', () => {
  it('releases after a JSON response', async () => {
    const seeded = withTaggedCtx('json')
    const r = await handler(new Request('http://localhost/json', { method: 'POST' }))
    await r.text()
    expect(seeded.isReleased()).toBe(true)
  })

  it('releases after a passthrough Response', async () => {
    const seeded = withTaggedCtx('response')
    const r = await handler(new Request('http://localhost/response', { method: 'POST' }))
    await r.text()
    expect(seeded.isReleased()).toBe(true)
  })

  it('releases after an SSE stream is fully consumed', async () => {
    const seeded = withTaggedCtx('sse')
    const r = await handler(new Request('http://localhost/sse', { method: 'POST' }))
    const reader = r.body!.getReader()
    // Drain the stream
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
    expect(seeded.isReleased()).toBe(true)
  })

  it('releases after an SSE stream is cancelled', async () => {
    const seeded = withTaggedCtx('sse-cancel')
    const r = await handler(new Request('http://localhost/sse', { method: 'POST' }))
    await r.body!.cancel()
    expect(seeded.isReleased()).toBe(true)
  })

  it('releases after an error path', async () => {
    const seeded = withTaggedCtx('fail')
    const r = await handler(new Request('http://localhost/fail', { method: 'POST' }))
    expect(r.status).toBe(400)
    await r.text()
    expect(seeded.isReleased()).toBe(true)
  })

  it('releases after input validation + resolver', async () => {
    const seeded = withTaggedCtx('echo')
    const r = await handler(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ msg: 'hi' }),
      }),
    )
    await r.text()
    expect(seeded.isReleased()).toBe(true)
  })
})
