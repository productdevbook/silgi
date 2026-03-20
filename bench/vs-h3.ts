/**
 * Benchmark: Katman vs H3 v2 vs oRPC — Full HTTP
 *
 * Fair comparison: same endpoints, same validation, same middleware logic.
 *
 * Run: node --experimental-strip-types bench/vs-h3.ts
 */

import { createServer } from 'node:http'

import { z } from 'zod'

import type { Server } from 'node:http'

const ITERATIONS = 3000
const KATMAN_PORT = 4200
const H3_PORT = 4201
const ORPC_PORT = 4202

// ── Schema ──────────────────────────────────────────

const EchoInput = z.object({ message: z.string() })
const GuardedInput = z.object({ name: z.string() })

// ═══════════════════════════════════════════════════
//  Katman Server
// ═══════════════════════════════════════════════════

import { compileRouter, ContextPool } from '../src/compile.ts'
import { katman } from '../src/katman.ts'

const k = katman({ context: () => ({}) })
const auth = k.guard(() => ({ userId: 1 }))

const katmanRouter = k.router({
  health: k.$resolve(async () => ({ status: 'ok' })),
  echo: k.$input(EchoInput as any).$resolve(async ({ input }: any) => ({ echo: input.message })),
  guarded: k
    .$use(auth)
    .$input(GuardedInput as any)
    .$resolve(async ({ input, ctx }: any) => ({ name: input.name, by: ctx.userId })),
})

async function startKatmanServer(): Promise<Server> {
  const flat = compileRouter(katmanRouter)
  const pool = new ContextPool()
  const signal = new AbortController().signal

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rawUrl = req.url ?? '/'
      const qIdx = rawUrl.indexOf('?')
      const pathname = qIdx === -1 ? rawUrl.slice(1) : rawUrl.slice(1, qIdx)

      const pipeline = flat.get(pathname)
      if (!pipeline) {
        res.statusCode = 404
        res.end()
        return
      }

      const ctx = pool.borrow()
      try {
        let rawInput: unknown
        const cl = req.headers['content-length']
        if (req.method !== 'GET' && cl && cl !== '0') {
          const text: string = await new Promise((r) => {
            let b = ''
            req.on('data', (d: Buffer) => {
              b += d
            })
            req.on('end', () => r(b))
          })
          if (text) rawInput = JSON.parse(text)
        } else if (req.method !== 'GET') {
          req.resume()
        }

        const output = await pipeline(ctx, rawInput, signal)
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(output))
      } catch (e: any) {
        res.statusCode = e.status ?? 500
        res.end(JSON.stringify({ error: e.message }))
      } finally {
        pool.release(ctx)
      }
    })
    server.listen(KATMAN_PORT, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  H3 v2 Server
// ═══════════════════════════════════════════════════

import { H3, readBody } from 'h3'

async function startH3Server(): Promise<Server> {
  const app = new H3()

  app.all('/health', () => ({ status: 'ok' }))

  app.all('/echo', async (event: any) => {
    const body = await readBody(event)
    const parsed = EchoInput.parse(body)
    return { echo: parsed.message }
  })

  app.all('/guarded', async (event: any) => {
    const userId = 1
    const body = await readBody(event)
    const parsed = GuardedInput.parse(body)
    return { name: parsed.name, by: userId }
  })

  // Use app.fetch wrapped in Node HTTP server
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${H3_PORT}${req.url}`
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v)
      }
      const body = await new Promise<string>((r) => {
        let b = ''
        req.on('data', (d: Buffer) => {
          b += d
        })
        req.on('end', () => r(b))
      })
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method !== 'GET' && req.method !== 'HEAD' ? body || undefined : undefined,
      })
      const response = await app.fetch(request)
      res.statusCode = response.status
      response.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(await response.text())
    })
    server.listen(H3_PORT, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  oRPC Server
// ═══════════════════════════════════════════════════

import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/node'

async function startORPCServer(): Promise<Server> {
  const orpcRouter = {
    health: os.handler(async () => ({ status: 'ok' })),
    echo: os.input(EchoInput).handler(async ({ input }) => ({ echo: input.message })),
    guarded: os
      .use(async ({ next }) => next({ context: { userId: 1 } }))
      .input(GuardedInput)
      .handler(async ({ input, context }) => ({
        name: input.name,
        by: (context as any).userId,
      })),
  }

  const handler = new RPCHandler(orpcRouter)

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} })
      if (!result.matched) {
        res.statusCode = 404
        res.end()
      }
    })
    server.listen(ORPC_PORT, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  Benchmark Runner
// ═══════════════════════════════════════════════════

async function bench(
  url: string,
  body: string | null,
  n: number,
): Promise<{ avg: number; rps: number; p50: number; p99: number }> {
  const opts: RequestInit = { method: 'POST' }
  if (body) {
    opts.headers = { 'content-type': 'application/json' }
    opts.body = body
  }

  // Warmup
  for (let i = 0; i < 200; i++) await (await fetch(url, opts)).text()

  const times: number[] = []
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    const s = performance.now()
    await (await fetch(url, opts)).text()
    times.push(performance.now() - s)
  }
  const total = performance.now() - t0
  times.sort((a, b) => a - b)

  return {
    avg: times.reduce((a, b) => a + b) / n,
    rps: Math.round((n / total) * 1000),
    p50: times[Math.floor(n * 0.5)]!,
    p99: times[Math.floor(n * 0.99)]!,
  }
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`
}

async function main() {
  console.log('Starting servers...')
  const [katmanSrv, h3Srv, orpcSrv] = await Promise.all([startKatmanServer(), startH3Server(), startORPCServer()])
  console.log('All servers ready.\n')

  console.log(`HTTP Benchmark — ${ITERATIONS} sequential requests | Node ${process.version}\n`)

  const scenarios = [
    { name: 'Simple (no mw, no validation)', path: 'health', body: null },
    { name: 'Zod input validation', path: 'echo', body: JSON.stringify({ message: 'hello' }) },
    { name: 'Guard + Zod validation', path: 'guarded', body: JSON.stringify({ name: 'Alice' }) },
  ]

  console.log('┌─────────────────────────────────┬───────────┬───────────┬───────────┐')
  console.log('│ Scenario                        │  Katman   │   H3 v2   │   oRPC    │')
  console.log('├─────────────────────────────────┼───────────┼───────────┼───────────┤')

  for (const s of scenarios) {
    const kResult = await bench(`http://127.0.0.1:${KATMAN_PORT}/${s.path}`, s.body, ITERATIONS)
    const hResult = await bench(`http://127.0.0.1:${H3_PORT}/${s.path}`, s.body, ITERATIONS)
    const oResult = await bench(`http://127.0.0.1:${ORPC_PORT}/${s.path}`, s.body, ITERATIONS)

    const kStr = `${fmt(kResult.avg).padStart(5)} ${String(kResult.rps).padStart(5)}/s`
    const hStr = `${fmt(hResult.avg).padStart(5)} ${String(hResult.rps).padStart(5)}/s`
    const oStr = `${fmt(oResult.avg).padStart(5)} ${String(oResult.rps).padStart(5)}/s`

    console.log(`│ ${s.name.padEnd(31)} │ ${kStr} │ ${hStr} │ ${oStr} │`)
  }

  console.log('└─────────────────────────────────┴───────────┴───────────┴───────────┘')

  // Summary
  console.log('\nDetailed (avg / p50 / p99):')
  for (const s of scenarios) {
    const kR = await bench(`http://127.0.0.1:${KATMAN_PORT}/${s.path}`, s.body, ITERATIONS)
    const hR = await bench(`http://127.0.0.1:${H3_PORT}/${s.path}`, s.body, ITERATIONS)
    const oR = await bench(`http://127.0.0.1:${ORPC_PORT}/${s.path}`, s.body, ITERATIONS)

    console.log(`\n  ${s.name}:`)
    console.log(`    Katman: avg ${fmt(kR.avg)} | p50 ${fmt(kR.p50)} | p99 ${fmt(kR.p99)} | ${kR.rps} req/s`)
    console.log(`    H3 v2:  avg ${fmt(hR.avg)} | p50 ${fmt(hR.p50)} | p99 ${fmt(hR.p99)} | ${hR.rps} req/s`)
    console.log(`    oRPC:   avg ${fmt(oR.avg)} | p50 ${fmt(oR.p50)} | p99 ${fmt(oR.p99)} | ${oR.rps} req/s`)
  }

  katmanSrv.close()
  h3Srv.close()
  orpcSrv.close()
}

main().catch(console.error)
