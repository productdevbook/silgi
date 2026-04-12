/**
 * HTTP benchmark — Silgi vs Fastify vs Hono vs Express.
 *
 * Measures real HTTP round-trip latency (sequential requests).
 * Each framework serves the same simple JSON endpoint.
 *
 * Methodology:
 * - Each framework runs individually (start → warmup → measure → stop)
 * - Proper await on server close before starting next
 * - Response correctness verified before measuring
 * - 3 rounds, median result reported
 *
 * Run: node --experimental-strip-types bench/http.ts
 */

import http from 'node:http'

import { serve as honoServe } from '@hono/node-server'
import express from 'express'
import Fastify from 'fastify'
import { Hono } from 'hono'
import { serve as srvxServe } from 'srvx'

import { silgi } from '../src/silgi.ts'

const REQUESTS = 5000
const WARMUP = 500
const ROUNDS = 3

// ── Helpers ──

interface Result {
  avg: number
  p50: number
  p95: number
  p99: number
  rps: number
}

async function measure(url: string, n: number): Promise<Result> {
  const times: number[] = []

  for (let i = 0; i < WARMUP; i++) {
    const res = await fetch(url, {
      method: 'POST',
      body: '{"limit":10}',
      headers: { 'content-type': 'application/json' },
    })
    await res.json()
  }

  for (let i = 0; i < n; i++) {
    const start = performance.now()
    const res = await fetch(url, {
      method: 'POST',
      body: '{"limit":10}',
      headers: { 'content-type': 'application/json' },
    })
    await res.json()
    times.push(performance.now() - start)
  }

  times.sort((a, b) => a - b)
  const avg = times.reduce((a, b) => a + b, 0) / times.length
  const p50 = times[Math.floor(times.length * 0.5)]!
  const p95 = times[Math.floor(times.length * 0.95)]!
  const p99 = times[Math.floor(times.length * 0.99)]!
  const rps = Math.round(1000 / avg)

  return {
    avg: Math.round(avg * 1000),
    p50: Math.round(p50 * 1000),
    p95: Math.round(p95 * 1000),
    p99: Math.round(p99 * 1000),
    rps,
  }
}

async function verify(url: string): Promise<void> {
  const res = await fetch(url, { method: 'POST', body: '{"limit":3}', headers: { 'content-type': 'application/json' } })
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`)
  const body = (await res.json()) as any
  if (!body.users || body.users.length !== 3) throw new Error(`Expected 3 users, got ${JSON.stringify(body)}`)
  if (body.users[0].id !== 1 || body.users[0].name !== 'User 1')
    throw new Error(`Bad user shape: ${JSON.stringify(body.users[0])}`)
}

function fmt(us: number): string {
  return `${us}µs`
}
function fmtRps(n: number): string {
  return `${n.toLocaleString()}/s`
}
function median(arr: Result[]): Result {
  const sorted = [...arr].toSorted((a, b) => a.avg - b.avg)
  return sorted[Math.floor(sorted.length / 2)]!
}

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

// ── Framework runners ──

async function benchSilgi(): Promise<Result> {
  const s = silgi({ context: () => ({}) })
  const router = s.router({
    users: {
      list: s.$resolve(({ input }) => ({ users: makeUsers((input as any)?.limit ?? 10) })),
    },
  })
  const handler = s.handler(router)
  const server = await srvxServe({ port: 0, hostname: '127.0.0.1', fetch: handler, silent: true })
  await server.ready()
  await verify(`${server.url}users/list`)
  const result = await measure(`${server.url}users/list`, REQUESTS)
  await server.close(true)
  return result
}

async function benchHono(): Promise<Result> {
  const app = new Hono()
  app.post('/users/list', async (c) => {
    const { limit = 10 } = await c.req.json()
    return c.json({ users: makeUsers(limit) })
  })
  const server = honoServe({ fetch: app.fetch, port: 0 }) as http.Server
  await new Promise<void>((resolve) => server.once('listening', resolve))
  const port = (server.address() as any).port
  const url = `http://127.0.0.1:${port}/users/list`
  await verify(url)
  const result = await measure(url, REQUESTS)
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return result
}

async function benchFastify(): Promise<Result> {
  const app = Fastify()
  app.post('/users/list', async (req) => {
    const { limit = 10 } = req.body as any
    return { users: makeUsers(limit) }
  })
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as any).port
  const url = `http://127.0.0.1:${port}/users/list`
  await verify(url)
  const result = await measure(url, REQUESTS)
  await app.close()
  return result
}

async function benchExpress(): Promise<Result> {
  const app = express()
  app.use(express.json())
  app.post('/users/list', (req, res) => {
    const { limit = 10 } = req.body
    res.json({ users: makeUsers(limit) })
  })
  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const port = (server.address() as any).port
  const url = `http://127.0.0.1:${port}/users/list`
  await verify(url)
  const result = await measure(url, REQUESTS)
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return result
}

// ── Run ──

const frameworks: [string, () => Promise<Result>][] = [
  ['Silgi', benchSilgi],
  ['Fastify', benchFastify],
  ['Hono', benchHono],
  ['Express', benchExpress],
]

// Round-robin: alternate frameworks each round to eliminate ordering bias.
// V8 JIT warmup and GC pressure affect the first framework unfairly otherwise.
const allResults = new Map<string, Result[]>(frameworks.map(([name]) => [name, []]))

for (let round = 0; round < ROUNDS; round++) {
  // Rotate starting position each round
  const offset = round % frameworks.length
  for (let i = 0; i < frameworks.length; i++) {
    const [name, fn] = frameworks[(i + offset) % frameworks.length]!
    allResults.get(name)!.push(await fn())
  }
}

console.log(`\nHTTP Benchmark — ${REQUESTS} requests × ${ROUNDS} rounds (${WARMUP} warmup each)\n`)
console.log('| Framework | avg | p50 | p95 | p99 | req/s |')
console.log('|---|---|---|---|---|---|')

const sorted = frameworks
  .map(([name]) => [name, median(allResults.get(name)!)] as const)
  .toSorted(([, a], [, b]) => a.avg - b.avg)

for (const [name, r] of sorted) {
  console.log(`| ${name} | ${fmt(r.avg)} | ${fmt(r.p50)} | ${fmt(r.p95)} | ${fmt(r.p99)} | ${fmtRps(r.rps)} |`)
}

console.log()
