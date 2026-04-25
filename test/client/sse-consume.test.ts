/**
 * Client-side SSE decoding — covers fetch + ofetch adapters.
 *
 * Pins the contract from issue #24: the typed client returns a Promise
 * that resolves to an `AsyncIterableIterator`, NOT a Promise<string>.
 * The iterator yields each frame parsed back into the declared output
 * shape, so `consumeIterator` works end-to-end.
 */

import { createServer } from 'node:http'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'

import { RPCLink } from '#src/client/adapters/fetch/index.ts'
import { createLink as createOfetchLink } from '#src/client/adapters/ofetch/index.ts'
import { createClient } from '#src/client/client.ts'
import { consumeIterator } from '#src/client/consume.ts'
import { silgi } from '#src/silgi.ts'

import type { InferClient } from '#src/types.ts'
import type { Server } from 'node:http'

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  countdown: k
    .subscription()
    .$input(z.object({ from: z.number() }))
    .$resolve(async function* ({ input }) {
      for (let i = input.from; i > 0; i--) yield { count: i }
    }),
})

type AppRouter = typeof appRouter
const handle = k.handler(appRouter)

// ── shared loopback HTTP server (streams the response body) ─

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = `http://localhost${req.url}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0]! : value)
    }
    let body: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise<string>((resolve) => {
        let data = ''
        req.on('data', (chunk: Buffer) => {
          data += chunk
        })
        req.on('end', () => resolve(data))
      })
    }
    const fetchReq = new Request(url, { method: req.method, headers, body: body || undefined })
    const fetchRes = await handle(fetchReq)

    // Stream the response body so SSE frames flow through to the
    // client incrementally — `await fetchRes.text()` would defeat the
    // whole point of an event-stream test.
    res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers))
    if (fetchRes.body) {
      const reader = fetchRes.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

describe('fetch adapter — SSE subscription', () => {
  it('resolves the call to an iterator that yields each event', async () => {
    const link = new RPCLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const iterator = await client.countdown({ from: 3 })
    expect(typeof iterator?.next).toBe('function')

    const events: { count: number }[] = []
    await consumeIterator(iterator, { onEvent: (e) => void events.push(e) })

    expect(events).toEqual([{ count: 3 }, { count: 2 }, { count: 1 }])
  })
})

describe('ofetch adapter — SSE subscription', () => {
  it('resolves the call to an iterator that yields each event', async () => {
    const link = createOfetchLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const iterator = await client.countdown({ from: 3 })
    expect(typeof iterator?.next).toBe('function')

    const events: { count: number }[] = []
    await consumeIterator(iterator, { onEvent: (e) => void events.push(e) })

    expect(events).toEqual([{ count: 3 }, { count: 2 }, { count: 1 }])
  })
})
