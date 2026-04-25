/**
 * v2 subscription (SSE) — end-to-end streaming test.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({}) })

const router = k.router({
  countdown: k.subscription(async function* () {
    for (let i = 3; i > 0; i--) yield { count: i }
  }),

  // Subscription with $output — every yielded item must be validated.
  withOutput: k
    .subscription()
    .$input(z.object({ from: z.number() }))
    .$output(z.object({ count: z.number() }))
    .$resolve(async function* ({ input }) {
      for (let i = input.from; i > 0; i--) yield { count: i }
    }),

  // Subscription whose resolver yields a value the output schema rejects.
  invalidYield: k
    .subscription()
    .$output(z.object({ count: z.number() }))
    .$resolve(async function* () {
      yield { count: 1 }
      yield { wrong: 'shape' } as unknown as { count: number }
    }),
})

const handle = k.handler(router)

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let all = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    all += decoder.decode(value, { stream: true })
  }
  return all
}

describe('v2 subscription (SSE)', () => {
  it('returns text/event-stream content type', async () => {
    const res = await handle(new Request('http://localhost/countdown', { method: 'POST' }))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(res.body).toBeTruthy()
  })

  it('streams all events', async () => {
    const res = await handle(new Request('http://localhost/countdown', { method: 'POST' }))
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let all = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      all += decoder.decode(value, { stream: true })
    }

    // Should contain data events for count 3, 2, 1
    const dataLines = all.split('\n').filter((l) => l.startsWith('data:'))
    expect(dataLines.length).toBeGreaterThanOrEqual(3)

    const values = dataLines
      .map((l) => l.replace('data: ', '').trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)

    expect(values).toContainEqual({ count: 3 })
    expect(values).toContainEqual({ count: 2 })
    expect(values).toContainEqual({ count: 1 })
  })

  // Regression for #26 — output schema used to be applied to the
  // iterator object instead of each yielded item, so any subscription
  // with `$output` 400'd at request time.
  it('validates each yielded item when $output is set', async () => {
    const res = await handle(
      new Request('http://localhost/withOutput', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: 3 }),
      }),
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream')

    const body = await readBody(res)
    const values = body
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.replace('data: ', '').trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { count: number })

    expect(values).toEqual([{ count: 3 }, { count: 2 }, { count: 1 }])
  })

  // When a yielded value fails the schema, the stream surfaces the
  // crash as an SSE `error` event after any frames that did pass.
  it('emits an error event mid-stream when a yield fails the output schema', async () => {
    const res = await handle(
      new Request('http://localhost/invalidYield', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(res.status).toBe(200)
    const body = await readBody(res)
    expect(body).toContain('data: {"count":1}')
    expect(body).toContain('event: error')
  })
})
