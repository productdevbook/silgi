/**
 * serve() with ws: true — WebSocket + HTTP on same server.
 *
 * Tests that serve() properly attaches crossws when ws: true is set.
 * Since serve() doesn't return a server reference, we test
 * attachWebSocket directly with a manually created server.
 */

import { createServer } from 'node:http'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { z } from 'zod'

import { katman } from '#src/katman.ts'
import { attachWebSocket } from '#src/ws.ts'

import type { Server } from 'node:http'

// ── Setup ──────────────────────────────────────────

const k = katman({ context: () => ({}) })

const appRouter = k.router({
  health: k.query(() => ({ status: 'ok' })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
})

const handle = k.handler(appRouter)
let server: Server
let baseUrl: string
let wsUrl: string

beforeAll(async () => {
  // Create HTTP server with both HTTP handler and WebSocket
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
    res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers))
    res.end(await fetchRes.text())
  })

  // Attach WebSocket (same as serve() does with ws: true)
  attachWebSocket(server, appRouter)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
      wsUrl = `ws://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

// ── Tests ──────────────────────────────────────────

describe('HTTP + WebSocket on same server', () => {
  it('HTTP health check works', async () => {
    const res = await fetch(`${baseUrl}/health`, { method: 'POST' })
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('WebSocket RPC works on same port', async () => {
    const result = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: '1', path: 'health' }))
      })
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()))
        ws.close()
      })
      ws.on('error', reject)
    })

    expect(result.result.status).toBe('ok')
  })

  it('both protocols work concurrently', async () => {
    // Fire HTTP and WebSocket requests at the same time
    const [httpResult, wsResult] = await Promise.all([
      fetch(`${baseUrl}/health`, { method: 'POST' }).then((r) => r.json()),
      new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(wsUrl)
        ws.on('open', () => {
          ws.send(JSON.stringify({ id: '1', path: 'echo', input: { msg: 'ws' } }))
        })
        ws.on('message', (data) => {
          resolve(JSON.parse(data.toString()))
          ws.close()
        })
        ws.on('error', reject)
      }),
    ])

    expect(httpResult.status).toBe('ok')
    expect(wsResult.result.echo).toBe('ws')
  })
})
