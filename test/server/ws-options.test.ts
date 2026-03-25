/**
 * WebSocket options tests — compression, keepalive, maxPayload.
 *
 * Tests that WSAdapterOptions are properly applied.
 */

import { createServer } from 'node:http'

import { describe, it, expect, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'
import { attachWebSocket } from '#src/ws.ts'

import type { Server } from 'node:http'

// ── Setup ──────────────────────────────────────────

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  health: k.$route({ ws: true }).$resolve(() => ({ status: 'ok' })),
  echo: k
    .$route({ ws: true })
    .$input(z.object({ msg: z.string() }))
    .$resolve(({ input }) => ({ echo: input.msg })),
})

const handle = k.handler(appRouter)

let server: Server | undefined

function createTestServer(): Server {
  return createServer(async (req, res) => {
    const url = `http://localhost${req.url}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0]! : value)
    }
    const fetchReq = new Request(url, { method: req.method, headers })
    const fetchRes = await handle(fetchReq)
    res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers))
    res.end(await fetchRes.text())
  })
}

async function listen(srv: Server): Promise<string> {
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as { port: number }
      resolve(`ws://127.0.0.1:${addr.port}`)
    })
  })
}

afterEach(() => {
  if (server) {
    server.close()
    server = undefined
  }
})

// ── Helper ────────────────────────────────────────

function wsRPC(url: string, path: string, input?: unknown, wsOptions?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, wsOptions)
    ws.on('open', () => {
      ws.send(JSON.stringify({ id: '1', path, input }))
    })
    ws.on('message', (data) => {
      resolve(JSON.parse(data.toString()))
      ws.close()
    })
    ws.on('error', reject)
    ws.on('close', (code) => {
      // Abnormal close (e.g. maxPayload exceeded) → reject
      if (code !== 1000 && code !== 1005) reject(new Error(`WebSocket closed with code ${code}`))
    })
    setTimeout(() => {
      ws.close()
      reject(new Error('timeout'))
    }, 5000)
  })
}

// ── Tests ──────────────────────────────────────────

describe('WebSocket options', () => {
  it('works with compress: true', async () => {
    server = createTestServer()
    await attachWebSocket(server, appRouter, { compress: true })
    const url = await listen(server)

    // Client must also negotiate permessage-deflate
    const result = await wsRPC(url, 'health', undefined, { perMessageDeflate: true })
    expect(result.result.status).toBe('ok')
  })

  it('works with maxPayload setting', async () => {
    server = createTestServer()
    // Set very small max payload — 50 bytes
    await attachWebSocket(server, appRouter, { maxPayload: 50 })
    const url = await listen(server)

    // Small message should work
    const result = await wsRPC(url, 'health')
    expect(result.result.status).toBe('ok')

    // Large message should cause disconnect
    const bigMsg = 'x'.repeat(200)
    await expect(wsRPC(url, 'echo', { msg: bigMsg })).rejects.toThrow()
  })

  it('works with keepalive: false (no ping/pong)', async () => {
    server = createTestServer()
    await attachWebSocket(server, appRouter, { keepalive: false })
    const url = await listen(server)

    const result = await wsRPC(url, 'health')
    expect(result.result.status).toBe('ok')
  })

  it('works with keepalive interval', async () => {
    server = createTestServer()
    await attachWebSocket(server, appRouter, { keepalive: 60_000 })
    const url = await listen(server)

    const result = await wsRPC(url, 'health')
    expect(result.result.status).toBe('ok')
  })

  it('works with all options combined', async () => {
    server = createTestServer()
    await attachWebSocket(server, appRouter, {
      compress: true,
      maxPayload: 1_048_576,
      keepalive: 30_000,
    })
    const url = await listen(server)

    const result = await wsRPC(url, 'echo', { msg: 'hello' })
    expect(result.result.echo).toBe('hello')
  })
})
