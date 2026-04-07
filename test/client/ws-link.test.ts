/**
 * WSLink integration tests — single response + streaming subscription.
 */

import { createServer } from 'node:http'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import { WSLink } from '#src/client/adapters/websocket/index.ts'
import { createClient } from '#src/client/client.ts'
import { silgi } from '#src/silgi.ts'
import { attachWebSocket } from '#src/ws.ts'

import type { Server } from 'node:http'

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  // No ws flag — should still be reachable via WS
  hello: k.$resolve(() => ({ msg: 'hi' })),
  // Subscription — streams over WS as async iterator
  ticks: k.subscription().$resolve(async function* () {
    for (let i = 0; i < 3; i++) yield { n: i }
  }),
})

type App = typeof appRouter

let server: Server
let wsUrl: string

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  await attachWebSocket(server, appRouter)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      wsUrl = `ws://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

describe('WSLink', () => {
  it('calls a non-ws-flagged procedure over WebSocket', async () => {
    const link = new WSLink({ url: wsUrl })
    const client = createClient<App>(link)
    const result = (await (client as any).hello()) as { msg: string }
    expect(result.msg).toBe('hi')
    link.dispose()
  })

  it('iterates a subscription as an async iterator', async () => {
    const link = new WSLink({ url: wsUrl })
    const client = createClient<App>(link)
    const iter = (await (client as any).ticks()) as AsyncIterableIterator<{ n: number }>

    const received: number[] = []
    for await (const ev of iter) received.push(ev.n)

    expect(received).toEqual([0, 1, 2])
    link.dispose()
  })
})
