/**
 * Benchmark: Katman vs oRPC vs tRPC vs Hono vs H3 — Full HTTP
 *
 * Fair comparison: same endpoints, same validation, same middleware.
 * All servers use Node.js HTTP with real TCP connections.
 *
 * Run: node --experimental-strip-types bench/vs-all.ts
 */

import { createServer } from 'node:http'

import { z } from 'zod'

import type { Server } from 'node:http'

const ITERATIONS = 3000
const PORTS = { katman: 4500, orpc: 4501, h3: 4502, hono: 4503, trpc: 4504 }

const EchoInput = z.object({ message: z.string() })
const GuardedInput = z.object({ name: z.string() })

// ═══════════════════════════════════════════════════
//  Katman
// ═══════════════════════════════════════════════════

import { compileRouter, ContextPool } from '../src/compile.ts'
import { katman } from '../src/katman.ts'

async function startKatman(): Promise<Server> {
  const k = katman({ context: () => ({}) })
  const auth = k.guard(() => ({ userId: 1 }))
  const router = k.router({
    health: k.$resolve(() => ({ status: 'ok' })),
    echo: k.$input(EchoInput as any).$resolve(({ input }: any) => ({ echo: input.message })),
    guarded: k
      .$use(auth)
      .$input(GuardedInput as any)
      .$resolve(({ input, ctx }: any) => ({ name: input.name, by: ctx.userId })),
  })
  const flat = compileRouter(router)
  const pool = new ContextPool()
  const signal = new AbortController().signal

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const pathname = (req.url ?? '/').slice(1).split('?')[0]!
      const route = flat.get(pathname)
      if (!route) {
        res.statusCode = 404
        res.end()
        return
      }
      const ctx = pool.borrow()
      try {
        let input: unknown
        if (req.method !== 'GET' && req.headers['content-length']) {
          const text: string = await new Promise((r) => {
            let b = ''
            req.on('data', (d: Buffer) => (b += d))
            req.on('end', () => r(b))
          })
          if (text) input = JSON.parse(text)
        }
        const output = await route.handler(ctx, input, signal)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(output))
      } catch (e: any) {
        res.statusCode = e.status ?? 500
        res.end(JSON.stringify({ error: e.message }))
      } finally {
        pool.release(ctx)
      }
    })
    server.listen(PORTS.katman, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  oRPC
// ═══════════════════════════════════════════════════

import { os } from '@orpc/server'
import { RPCHandler } from '@orpc/server/node'

async function startORPC(): Promise<Server> {
  const router = {
    health: os.handler(() => ({ status: 'ok' })),
    echo: os.input(EchoInput).handler(({ input }) => ({ echo: input.message })),
    guarded: os
      .use(async ({ next }) => next({ context: { userId: 1 } }))
      .input(GuardedInput)
      .handler(({ input, context }) => ({ name: input.name, by: (context as any).userId })),
  }
  const handler = new RPCHandler(router)
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} })
      if (!result.matched) {
        res.statusCode = 404
        res.end()
      }
    })
    server.listen(PORTS.orpc, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  H3 v2
// ═══════════════════════════════════════════════════

import { H3 } from 'h3'

async function startH3(): Promise<Server> {
  const app = new H3()
  app.all('/health', () => ({ status: 'ok' }))
  app.all('/echo', async (event: any) => {
    const body = await event.req.json()
    return { echo: EchoInput.parse(body).message }
  })
  app.all('/guarded', async (event: any) => {
    const body = await event.req.json()
    return { name: GuardedInput.parse(body).name, by: 1 }
  })

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${PORTS.h3}${req.url}`
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v)
      }
      const body = await new Promise<string>((r) => {
        let b = ''
        req.on('data', (d: Buffer) => (b += d))
        req.on('end', () => r(b))
      })
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? body || undefined : undefined,
      })
      const response = await app.fetch(request)
      res.statusCode = response.status
      response.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(await response.text())
    })
    server.listen(PORTS.h3, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  Hono
// ═══════════════════════════════════════════════════

import { Hono } from 'hono'

async function startHono(): Promise<Server> {
  const app = new Hono()
  app.post('/health', (c) => c.json({ status: 'ok' }))
  app.post('/echo', async (c) => {
    const body = await c.req.json()
    return c.json({ echo: EchoInput.parse(body).message })
  })
  app.post('/guarded', async (c) => {
    const body = await c.req.json()
    return c.json({ name: GuardedInput.parse(body).name, by: 1 })
  })

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${PORTS.hono}${req.url}`
      const headers = new Headers()
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v)
      }
      const body = await new Promise<string>((r) => {
        let b = ''
        req.on('data', (d: Buffer) => (b += d))
        req.on('end', () => r(b))
      })
      const request = new Request(url, {
        method: req.method,
        headers,
        body: req.method !== 'GET' ? body || undefined : undefined,
      })
      const response = await app.fetch(request)
      res.statusCode = response.status
      response.headers.forEach((v, k) => res.setHeader(k, v))
      res.end(await response.text())
    })
    server.listen(PORTS.hono, '127.0.0.1', () => resolve(server))
  })
}

// ═══════════════════════════════════════════════════
//  Benchmark Runner
// ═══════════════════════════════════════════════════

async function bench(url: string, body: string | null, n: number) {
  const opts: RequestInit = { method: 'POST' }
  if (body) {
    opts.headers = { 'content-type': 'application/json' }
    opts.body = body
  }
  for (let i = 0; i < 200; i++) await (await fetch(url, opts)).text() // warmup
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

function fmt(ms: number) {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`
}

async function main() {
  console.log('Starting 4 servers...')
  const [katmanSrv, orpcSrv, h3Srv, honoSrv] = await Promise.all([startKatman(), startORPC(), startH3(), startHono()])
  console.log('All ready.\n')
  console.log(
    `Full HTTP Benchmark — ${ITERATIONS} sequential requests | Node ${process.version} | ${new Date().toISOString().split('T')[0]}\n`,
  )

  const scenarios = [
    { name: 'Simple (no middleware)', path: 'health', body: null },
    { name: 'Zod validation', path: 'echo', body: JSON.stringify({ message: 'hello' }) },
    { name: 'Guard + Zod', path: 'guarded', body: JSON.stringify({ name: 'Alice' }) },
  ]

  console.log('┌─────────────────────────────┬──────────────┬──────────────┬──────────────┬──────────────┐')
  console.log('│ Scenario                    │   Katman     │   oRPC       │   H3 v2      │   Hono       │')
  console.log('├─────────────────────────────┼──────────────┼──────────────┼──────────────┼──────────────┤')

  const results: any[] = []
  for (const s of scenarios) {
    const kR = await bench(`http://127.0.0.1:${PORTS.katman}/${s.path}`, s.body, ITERATIONS)
    const oR = await bench(`http://127.0.0.1:${PORTS.orpc}/${s.path}`, s.body, ITERATIONS)
    const hR = await bench(`http://127.0.0.1:${PORTS.h3}/${s.path}`, s.body, ITERATIONS)
    const nR = await bench(`http://127.0.0.1:${PORTS.hono}/${s.path}`, s.body, ITERATIONS)
    results.push({ name: s.name, katman: kR, orpc: oR, h3: hR, hono: nR })

    const kStr = `${fmt(kR.avg).padStart(5)} ${String(kR.rps).padStart(5)}/s`
    const oStr = `${fmt(oR.avg).padStart(5)} ${String(oR.rps).padStart(5)}/s`
    const hStr = `${fmt(hR.avg).padStart(5)} ${String(hR.rps).padStart(5)}/s`
    const nStr = `${fmt(nR.avg).padStart(5)} ${String(nR.rps).padStart(5)}/s`
    console.log(`│ ${s.name.padEnd(27)} │ ${kStr} │ ${oStr} │ ${hStr} │ ${nStr} │`)
  }

  console.log('└─────────────────────────────┴──────────────┴──────────────┴──────────────┴──────────────┘')

  console.log('\n### Detailed (avg / p50 / p99):\n')
  for (const r of results) {
    console.log(`  ${r.name}:`)
    console.log(
      `    Katman: avg ${fmt(r.katman.avg)} | p50 ${fmt(r.katman.p50)} | p99 ${fmt(r.katman.p99)} | ${r.katman.rps} req/s`,
    )
    console.log(
      `    oRPC:   avg ${fmt(r.orpc.avg)} | p50 ${fmt(r.orpc.p50)} | p99 ${fmt(r.orpc.p99)} | ${r.orpc.rps} req/s`,
    )
    console.log(`    H3 v2:  avg ${fmt(r.h3.avg)} | p50 ${fmt(r.h3.p50)} | p99 ${fmt(r.h3.p99)} | ${r.h3.rps} req/s`)
    console.log(
      `    Hono:   avg ${fmt(r.hono.avg)} | p50 ${fmt(r.hono.p50)} | p99 ${fmt(r.hono.p99)} | ${r.hono.rps} req/s`,
    )
    console.log(
      `    → Katman vs oRPC: ${(r.orpc.avg / r.katman.avg).toFixed(1)}x | vs H3: ${(r.h3.avg / r.katman.avg).toFixed(1)}x | vs Hono: ${(r.hono.avg / r.katman.avg).toFixed(1)}x`,
    )
    console.log()
  }

  katmanSrv.close()
  orpcSrv.close()
  h3Srv.close()
  honoSrv.close()
}

main().catch(console.error)
