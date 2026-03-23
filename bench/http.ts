/**
 * HTTP benchmark — Silgi vs Hono vs Fastify vs Express.
 *
 * Measures real HTTP round-trip latency (sequential requests).
 * Each framework serves the same simple JSON endpoint.
 *
 * Note: Elysia is excluded — it only runs on Bun, not Node.js.
 *
 * Run: node --experimental-strip-types bench/http.ts
 */

import { Hono } from 'hono'
import { serve as honoServe } from '@hono/node-server'
import Fastify from 'fastify'
import express from 'express'
import { serve as srvxServe } from 'srvx'
import { silgi } from '../src/silgi.ts'

const REQUESTS = 3000
const WARMUP = 200

// ── Helpers ──

async function measure(url: string, n: number): Promise<{ avg: number; p50: number; p95: number; p99: number; rps: number }> {
  const times: number[] = []

  // Warmup
  for (let i = 0; i < WARMUP; i++) {
    const res = await fetch(url, { method: 'POST', body: '{"limit":10}', headers: { 'content-type': 'application/json' } })
    await res.json()
  }

  // Measure
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

  // Convert ms → µs
  return { avg: Math.round(avg * 1000), p50: Math.round(p50 * 1000), p95: Math.round(p95 * 1000), p99: Math.round(p99 * 1000), rps }
}

function fmt(us: number): string {
  return `${us}µs`
}

function fmtRps(n: number): string {
  return `${n.toLocaleString()}/s`
}

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

// ── Silgi (via srvx — same adapter as serve()) ──

async function benchSilgi(): Promise<ReturnType<typeof measure>> {
  const s = silgi({ context: () => ({}) })
  const router = s.router({
    users: {
      list: s.$resolve(({ input }) => ({ users: makeUsers((input as any)?.limit ?? 10) })),
    },
  })
  const handler = s.handler(router)
  const server = await srvxServe({ port: 0, fetch: handler })
  const result = await measure(`${server.url}users/list`, REQUESTS)
  await server.close()
  return result
}

// ── Hono ──

async function benchHono(): Promise<ReturnType<typeof measure>> {
  const app = new Hono()
  app.post('/users/list', async (c) => {
    const { limit = 10 } = await c.req.json()
    return c.json({ users: makeUsers(limit) })
  })
  const server = honoServe({ fetch: app.fetch, port: 0 }) as import('node:http').Server
  await new Promise<void>((resolve) => setTimeout(resolve, 100))
  const port = (server.address() as any).port
  const result = await measure(`http://localhost:${port}/users/list`, REQUESTS)
  server.close()
  return result
}

// ── Fastify ──

async function benchFastify(): Promise<ReturnType<typeof measure>> {
  const app = Fastify()
  app.post('/users/list', async (req) => {
    const { limit = 10 } = req.body as any
    return { users: makeUsers(limit) }
  })
  await app.listen({ port: 0 })
  const port = (app.server.address() as any).port
  const result = await measure(`http://localhost:${port}/users/list`, REQUESTS)
  await app.close()
  return result
}

// ── Express ──

async function benchExpress(): Promise<ReturnType<typeof measure>> {
  const app = express()
  app.use(express.json())
  app.post('/users/list', (req, res) => {
    const { limit = 10 } = req.body
    res.json({ users: makeUsers(limit) })
  })
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const s = app.listen(0, () => resolve(s))
  })
  const port = (server.address() as any).port
  const result = await measure(`http://localhost:${port}/users/list`, REQUESTS)
  server.close()
  return result
}

// ── Run ──

console.log(`\nHTTP Benchmark — ${REQUESTS} sequential requests (${WARMUP} warmup)\n`)

console.log('### Simple JSON endpoint (POST /users/list)\n')
console.log('| Framework | avg | p50 | p95 | p99 | req/s |')
console.log('|---|---|---|---|---|---|')

for (const [name, fn] of [
  ['Silgi', benchSilgi],
  ['Hono', benchHono],
  ['Fastify', benchFastify],
  ['Express', benchExpress],
] as const) {
  const r = await (fn as () => Promise<any>)()
  console.log(`| ${name} | ${fmt(r.avg)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmtRps(r.rps)} |`)
}

console.log()
