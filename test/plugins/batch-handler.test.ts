import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'
import { createBatchHandler } from '#src/plugins/batch-server.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

describe('createBatchHandler()', () => {
  it('processes multiple calls in one request', async () => {
    const router = k.router({
      health: k.$resolve(() => ({ status: 'ok' })),
      echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
    })

    const handler = createBatchHandler(router, { context: () => ({}) })

    const request = new Request('http://localhost/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ path: 'health' }, { path: 'echo', input: { msg: 'hi' } }, { path: 'nonexistent' }]),
    })

    const response = await handler(request)
    const results = await response.json()

    expect(results).toHaveLength(3)
    expect(results[0].data).toEqual({ status: 'ok' })
    expect(results[1].data).toEqual({ echo: 'hi' })
    expect(results[2].error.code).toBe('NOT_FOUND')
  })

  it('rejects oversized batches', async () => {
    const router = k.router({ health: k.$resolve(() => 'ok') })
    const handler = createBatchHandler(router, { context: () => ({}), maxBatchSize: 2 })

    const request = new Request('http://localhost/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ path: 'a' }, { path: 'b' }, { path: 'c' }]),
    })

    const response = await handler(request)
    expect(response.status).toBe(400)
  })
})
