/**
 * HTTP benchmark (Bun) — Silgi vs Elysia vs Hono.
 *
 * Runs on Bun only. Measures real HTTP round-trip latency.
 *
 * Run: bun bench/http-bun.ts
 */

import { Hono } from 'hono'
import { Elysia, t } from 'elysia'
import { silgi } from '../src/silgi.ts'
import { z } from 'zod'

const REQUESTS = 3000
const WARMUP = 200

// ── Helpers ──

async function measure(url: string, n: number): Promise<{ avg: number; p50: number; p95: number; p99: number; rps: number }> {
  const times: number[] = []

  for (let i = 0; i < WARMUP; i++) {
    const res = await fetch(url, { method: 'POST', body: '{"limit":10}', headers: { 'content-type': 'application/json' } })
    await res.json()
  }

  for (let i = 0; i < n; i++) {
    const start = performance.now()
    const res = await fetch(url, { method: 'POST', body: '{"limit":10}', headers: { 'content-type': 'application/json' } })
    await res.json()
    times.push(performance.now() - start)
  }

  times.sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const p50 = times[Math.floor(times.length * 0.5)]!
  const p95 = times[Math.floor(times.length * 0.95)]!
  const p99 = times[Math.floor(times.length * 0.99)]!
  const rps = Math.round(1000 / avg)

  return { avg: Math.round(avg * 1000), p50: Math.round(p50 * 1000), p95: Math.round(p95 * 1000), p99: Math.round(p99 * 1000), rps }
}

function fmt(us: number): string { return `${us}µs` }
function fmtRps(n: number): string { return `${n.toLocaleString()}/s` }

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

// ── Silgi ──

async function benchSilgi(): Promise<ReturnType<typeof measure>> {
  const s = silgi({ context: () => ({}) })
  const router = s.router({
    users: {
      list: s
        .$input(z.object({ limit: z.number().optional() }))
        .$resolve(({ input }) => ({ users: makeUsers(input.limit ?? 10) })),
    },
  })
  const handler = s.handler(router)
  const server = Bun.serve({ port: 0, fetch: handler })
  const result = await measure(`http://localhost:${server.port}/users/list`, REQUESTS)
  server.stop()
  return result
}

// ── Elysia ──

async function benchElysia(): Promise<ReturnType<typeof measure>> {
  const app = new Elysia()
    .post('/users/list', ({ body }) => {
      const limit = (body as any)?.limit ?? 10
      return { users: makeUsers(limit) }
    })
    .listen(0)

  const port = app.server!.port
  const result = await measure(`http://localhost:${port}/users/list`, REQUESTS)
  app.stop()
  return result
}

// ── Hono ──

async function benchHono(): Promise<ReturnType<typeof measure>> {
  const app = new Hono()
  app.post('/users/list', async (c) => {
    const { limit = 10 } = await c.req.json()
    return c.json({ users: makeUsers(limit) })
  })
  const server = Bun.serve({ port: 0, fetch: app.fetch })
  const result = await measure(`http://localhost:${server.port}/users/list`, REQUESTS)
  server.stop()
  return result
}

// ── Run ──

console.log(`\nHTTP Benchmark (Bun ${Bun.version}) — ${REQUESTS} sequential requests (${WARMUP} warmup)\n`)
console.log('| Framework | avg | p50 | p95 | p99 | req/s |')
console.log('|---|---|---|---|---|---|')

for (const [name, fn] of [
  ['Silgi', benchSilgi],
  ['Elysia', benchElysia],
  ['Hono', benchHono],
] as const) {
  const r = await (fn as () => Promise<any>)()
  console.log(`| ${name} | ${fmt(r.avg)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmtRps(r.rps)} |`)
}

console.log()
