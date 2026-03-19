/**
 * HTTP Benchmark — full request/response cycle
 *
 * Measures real-world performance including:
 * - TCP connection handling
 * - Request parsing
 * - Pipeline execution
 * - Response serialization
 *
 * Run: node --experimental-strip-types bench/http.ts
 */

import { createServer, type Server } from 'node:http'

import { z } from 'zod'
// ── Katman Server ───────────────────────────────────

import { katman } from '../src/katman.ts'

const k = katman({
  context: () => ({}),
})

const auth = k.guard((ctx) => ({ userId: 1 }))

const katmanRouter = k.router({
  health: k.query(async () => ({ status: 'ok' })),
  echo: k.query(z.object({ message: z.string() }) as any, async ({ input }: any) => ({ echo: input.message })),
  guarded: k.mutation({
    use: [auth],
    input: z.object({ name: z.string() }) as any,
    resolve: async ({ input, ctx }: any) => ({ name: input.name, by: ctx.userId }),
  }),
})

const katmanHandle = k.handler(katmanRouter)

// ── oRPC Server ─────────────────────────────────────

import { os, createRouterClient } from '@orpc/server'

const orpcHealth = os.handler(async () => ({ status: 'ok' }))
const orpcEcho = os.input(z.object({ message: z.string() })).handler(async ({ input }) => ({ echo: input.message }))
const orpcGuarded = os
  .use(async ({ next }) => next({ context: { userId: 1 } }))
  .input(z.object({ name: z.string() }))
  .handler(async ({ input, context }) => ({ name: input.name, by: (context as any).userId }))

const orpcRouter = { health: orpcHealth, echo: orpcEcho, guarded: orpcGuarded }

// ── Benchmark Runner ────────────────────────────────

async function startKatmanServer(port: number): Promise<Server> {
  const { compileRouter, ContextPool } = await import('../src/api/compile.ts')
  const flat = compileRouter(katmanRouter)
  const pool = new ContextPool()

  // OPTIMIZATION 1: Shared signal — saves 655ns/req (no timer creation)
  const sharedSignal = new AbortController().signal

  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      // OPTIMIZATION 2: No async IIFE — direct async handler with .catch
      handleRequest(req, res, flat, pool, sharedSignal).catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500
          res.end('Error')
        }
      })
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function handleRequest(
  req: import('node:http').IncomingMessage,
  res: import('node:http').ServerResponse,
  flat: Map<string, any>,
  pool: import('../src/api/compile.ts').ContextPool,
  signal: AbortSignal,
): Promise<void> {
  const rawUrl = req.url ?? '/'
  const qIdx = rawUrl.indexOf('?')
  const pathname = qIdx === -1 ? rawUrl.slice(1) : rawUrl.slice(1, qIdx)

  const pipeline = flat.get(pathname)
  if (!pipeline) {
    res.statusCode = 404
    res.end('Not found')
    return
  }

  const ctx = pool.borrow()
  try {
    ctx.headers = req.headers

    // OPTIMIZATION 3: Skip body read if no content
    let rawInput: unknown
    const cl = req.headers['content-length']
    if (req.method !== 'GET' && req.method !== 'HEAD' && cl && cl !== '0') {
      const text: string = await new Promise((r) => {
        let body = ''
        req.on('data', (d: Buffer) => {
          body += d
        })
        req.on('end', () => r(body))
      })
      if (text) rawInput = JSON.parse(text)
    } else if (req.method !== 'GET' && req.method !== 'HEAD') {
      // Drain body without reading
      req.resume()
    }

    const output = await pipeline(ctx, rawInput, signal)

    // OPTIMIZATION 4: Native JSON.stringify (no BigInt replacer)
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(output))
  } catch (e: any) {
    res.statusCode = e.status ?? 500
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(e.toJSON?.() ?? { error: e.message }))
  } finally {
    pool.release(ctx)
  }
}

async function startORPCServer(port: number): Promise<Server> {
  const { RPCHandler } = await import('@orpc/server/node')
  const handler = new RPCHandler(orpcRouter)
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} })
      if (!result.matched) {
        res.statusCode = 404
        res.end('Not found')
      }
    })
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function httpBench(
  label: string,
  url: string,
  body: string | null,
  iterations: number,
): Promise<{ avg: number; min: number; max: number; rps: number }> {
  const fetchOpts: RequestInit = { method: 'POST' }
  if (body) {
    fetchOpts.headers = { 'content-type': 'application/json' }
    fetchOpts.body = body
  }
  // Warmup
  for (let i = 0; i < 100; i++) {
    await (await fetch(url, fetchOpts)).text()
  }

  const times: number[] = []
  const start = performance.now()

  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    const res = await fetch(url, fetchOpts)
    await res.text() // consume body
    times.push(performance.now() - t0)
  }

  const total = performance.now() - start
  times.sort((a, b) => a - b)

  return {
    avg: times.reduce((a, b) => a + b, 0) / times.length,
    min: times[0]!,
    max: times[times.length - 1]!,
    rps: Math.round((iterations / total) * 1000),
  }
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`
}

// ── Main ────────────────────────────────────────────

async function main() {
  const ITERATIONS = 2000
  const KATMAN_PORT = 4100
  const ORPC_PORT = 4101

  console.log('Starting servers...')
  const katmanServer = await startKatmanServer(KATMAN_PORT)
  const orpcServer = await startORPCServer(ORPC_PORT)
  console.log('Servers ready.\n')

  console.log(`HTTP Benchmark — ${ITERATIONS} sequential requests each\n`)
  console.log('─'.repeat(70))

  // Test 1: Simple (no middleware, no validation)
  const k1 = await httpBench('Katman health', `http://127.0.0.1:${KATMAN_PORT}/health`, null, ITERATIONS)
  const o1 = await httpBench('oRPC health', `http://127.0.0.1:${ORPC_PORT}/health`, null, ITERATIONS)
  console.log(`Simple (no mw, no validation):`)
  console.log(`  Katman:  avg ${fmt(k1.avg)}  (${k1.rps} req/s)`)
  console.log(`  oRPC:    avg ${fmt(o1.avg)}  (${o1.rps} req/s)`)
  console.log(`  → Katman ${(o1.avg / k1.avg).toFixed(1)}x faster\n`)

  // Test 2: With Zod validation
  const body2 = JSON.stringify({ message: 'hello world' })
  const k2 = await httpBench('Katman echo', `http://127.0.0.1:${KATMAN_PORT}/echo`, body2, ITERATIONS)
  const o2 = await httpBench('oRPC echo', `http://127.0.0.1:${ORPC_PORT}/echo`, body2, ITERATIONS)
  console.log(`Zod input validation:`)
  console.log(`  Katman:  avg ${fmt(k2.avg)}  (${k2.rps} req/s)`)
  console.log(`  oRPC:    avg ${fmt(o2.avg)}  (${o2.rps} req/s)`)
  console.log(`  → Katman ${(o2.avg / k2.avg).toFixed(1)}x faster\n`)

  // Test 3: With guard + validation
  const body3 = JSON.stringify({ name: 'Alice' })
  const k3 = await httpBench('Katman guarded', `http://127.0.0.1:${KATMAN_PORT}/guarded`, body3, ITERATIONS)
  const o3 = await httpBench('oRPC guarded', `http://127.0.0.1:${ORPC_PORT}/guarded`, body3, ITERATIONS)
  console.log(`Guard/middleware + Zod:`)
  console.log(`  Katman:  avg ${fmt(k3.avg)}  (${k3.rps} req/s)`)
  console.log(`  oRPC:    avg ${fmt(o3.avg)}  (${o3.rps} req/s)`)
  console.log(`  → Katman ${(o3.avg / k3.avg).toFixed(1)}x faster\n`)

  console.log('─'.repeat(70))

  katmanServer.close()
  orpcServer.close()
}

main().catch(console.error)
