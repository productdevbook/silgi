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

import { silgi } from '#src/silgi.ts'
import { attachWebSocket } from '#src/ws.ts'

import type { Server } from 'node:http'

// ── Setup ──────────────────────────────────────────

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
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

  // Attach WebSocket
  await attachWebSocket(server, appRouter)

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

// ── Regression: issue #3 — contextFactory must be forwarded to WS hooks ────
// The fix in silgi.ts handler() wraps contextFactory so peer.request is passed
// to it. We test the same bridge logic via attachWebSocket + an explicit context
// option that mirrors what handler() now does internally.

describe('WebSocket context — contextFactory forwarded to procedures', () => {
  const ctxFactory = (req: Request) => ({
    customHeader: req.headers.get('x-test-header') ?? 'missing',
  })

  const kCtx = silgi({ context: ctxFactory })

  const ctxRouter = kCtx.router({
    echoCtx: kCtx.$resolve(({ ctx }) => ({ customHeader: ctx.customHeader })),
  })

  let ctxServer: Server
  let ctxWsUrl: string

  beforeAll(async () => {
    ctxServer = createServer((_req, res) => {
      res.writeHead(200)
      res.end()
    })

    // Mirror the bridge applied by handler() after the fix:
    // peer.request is a Request-like (NodeReqProxy extends StubRequest which
    // sets its prototype to Request.prototype, so instanceof Request is true).
    await attachWebSocket(ctxServer, ctxRouter, {
      context: (peer) => {
        const req: Request = (peer?.request instanceof Request ? peer.request : peer) as Request
        return ctxFactory(req)
      },
    })

    await new Promise<void>((resolve) => {
      ctxServer.listen(0, '127.0.0.1', () => {
        const addr = ctxServer.address() as { port: number }
        ctxWsUrl = `ws://127.0.0.1:${addr.port}`
        resolve()
      })
    })
  })

  afterAll(() => {
    ctxServer?.close()
  })

  it('subscription receives ctx populated from contextFactory', async () => {
    const result = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(ctxWsUrl, { headers: { 'x-test-header': 'hello-ctx' } })
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: '1', path: 'echoCtx' }))
      })
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()))
        ws.close()
      })
      ws.on('error', reject)
      setTimeout(() => {
        ws.close()
        reject(new Error('timeout'))
      }, 5000)
    })

    // Before fix: result.result.customHeader === 'missing' (ctx was always empty)
    // After fix: ctx is populated from contextFactory via peer.request
    expect(result.result.customHeader).toBe('hello-ctx')
  })

  it('ctx falls back to "missing" when header is absent', async () => {
    const result = await new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(ctxWsUrl)
      ws.on('open', () => {
        ws.send(JSON.stringify({ id: '1', path: 'echoCtx' }))
      })
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()))
        ws.close()
      })
      ws.on('error', reject)
      setTimeout(() => {
        ws.close()
        reject(new Error('timeout'))
      }, 5000)
    })

    expect(result.result.customHeader).toBe('missing')
  })
})
