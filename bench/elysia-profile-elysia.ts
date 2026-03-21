/**
 * Profile Elysia handler to compare.
 * Run: bun bench/elysia-profile-elysia.ts
 */

import { Elysia } from 'elysia'
import { z } from 'zod'

const NameInput = z.object({ name: z.string() })

const app = new Elysia()
  .derive(() => ({ db: 'postgres' as const }))
  .derive(() => ({ userId: 1 as const }))
  .post('/greet', ({ body, userId }) => {
    const input = NameInput.parse(body)
    return { hello: input.name, by: userId }
  })

const body = JSON.stringify({ name: 'Alice' })
const req = () =>
  new Request('http://127.0.0.1:4401/greet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

// Warmup
for (let i = 0; i < 1000; i++) await app.fetch(req())

// Profile
const N = 100_000
const t0 = performance.now()
for (let i = 0; i < N; i++) {
  await app.fetch(req())
}
const elapsed = performance.now() - t0
const perReq = (elapsed / N) * 1000

console.log(`${N} requests in ${elapsed.toFixed(0)}ms`)
console.log(`${perReq.toFixed(1)}µs per request`)
console.log(`${Math.round((N / elapsed) * 1000)} req/s`)
