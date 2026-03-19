/**
 * WebSocket RPC adapter — integration tests.
 */

import { createServer, type Server } from 'node:http'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { WebSocket } from 'ws'
import { z } from 'zod'

import { compileRouter } from '#src/compile.ts'
import { katman } from '#src/katman.ts'
import { attachWebSocket } from '#src/ws.ts'

// ── Setup ──────────────────────────────────────────

const k = katman({ context: () => ({}) })

const appRouter = k.router({
  health: k.query(() => ({ status: 'ok' })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  add: k.mutation(z.object({ a: z.number(), b: z.number() }), ({ input }) => ({ sum: input.a + input.b })),
})

let server: Server
let wsUrl: string

beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200)
    res.end('ok')
  })
  attachWebSocket(server, appRouter)

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

// ── Helpers ────────────────────────────────────────

function rpc(path: string, input?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const id = Math.random().toString(36).slice(2)

    ws.on('open', () => {
      ws.send(JSON.stringify({ id, path, input }))
    })

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      ws.close()
      if (msg.error) reject(msg.error)
      else resolve(msg.result)
    })

    ws.on('error', reject)
    setTimeout(() => {
      ws.close()
      reject(new Error('timeout'))
    }, 5000)
  })
}

// ── Tests ──────────────────────────────────────────

describe('WebSocket RPC (crossws)', () => {
  it('calls a no-input query', async () => {
    const result = await rpc('health')
    expect(result.status).toBe('ok')
  })

  it('calls a query with input', async () => {
    const result = await rpc('echo', { msg: 'hello ws' })
    expect(result.echo).toBe('hello ws')
  })

  it('calls a mutation', async () => {
    const result = await rpc('add', { a: 10, b: 32 })
    expect(result.sum).toBe(42)
  })

  it('returns error for unknown route', async () => {
    await expect(rpc('nonexistent')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('returns error for invalid input', async () => {
    await expect(rpc('echo', { wrong: 'field' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    })
  })

  it('handles multiple sequential calls on same connection', async () => {
    const ws = new WebSocket(wsUrl)
    const results: any[] = []

    await new Promise<void>((resolve) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: '1', path: 'health' }))
        ws.send(JSON.stringify({ id: '2', path: 'echo', input: { msg: 'test' } }))
        ws.send(JSON.stringify({ id: '3', path: 'add', input: { a: 1, b: 2 } }))
      })

      ws.on('message', (data) => {
        results.push(JSON.parse(data.toString()))
        if (results.length === 3) {
          ws.close()
          resolve()
        }
      })
    })

    const byId = Object.fromEntries(results.map((r) => [r.id, r]))
    expect(byId['1'].result.status).toBe('ok')
    expect(byId['2'].result.echo).toBe('test')
    expect(byId['3'].result.sum).toBe(3)
  })
})
