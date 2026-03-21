/**
 * Profile Silgi Bun adapter — micro breakdown.
 * Run: bun bench/elysia-profile.ts
 */

import { z } from 'zod'

import { silgiBun } from '../src/adapters/bun.ts'
import { compileRouter } from '../src/compile.ts'
import { Elysia } from 'elysia'
import { silgi } from '../src/silgi.ts'

const NameInput = z.object({ name: z.string() })

// ── Silgi ──
const k = silgi({ context: () => ({}) })
const auth = k.guard(() => ({ userId: 1 }))
const router = k.router({
  greet: k.$use(auth).$input(NameInput).$resolve(({ input, ctx }) => ({ hello: input.name, by: ctx.userId })),
})
const bunConfig = silgiBun(router, { context: () => ({ db: 'postgres' }), port: 4400 })

// ── Elysia ──
const app = new Elysia()
  .derive(() => ({ db: 'postgres' as const }))
  .derive(() => ({ userId: 1 as const }))
  .post('/greet', ({ body, userId }) => {
    const input = NameInput.parse(body)
    return { hello: input.name, by: userId }
  })

const body = JSON.stringify({ name: 'Alice' })
const req = () =>
  new Request('http://127.0.0.1:4400/greet', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  })

const N = 200_000

// Warmup both
for (let i = 0; i < 2000; i++) await bunConfig.fetch(req())
for (let i = 0; i < 2000; i++) await app.fetch(req())

function bench(label: string, fn: () => any) {
  const t = performance.now()
  for (let i = 0; i < N; i++) fn()
  console.log(`${label.padEnd(25)} ${(((performance.now() - t) / N) * 1000).toFixed(3)}µs`)
}

async function benchAsync(label: string, fn: () => Promise<any>) {
  const t = performance.now()
  for (let i = 0; i < N; i++) await fn()
  console.log(`${label.padEnd(25)} ${(((performance.now() - t) / N) * 1000).toFixed(3)}µs`)
}

// ── Breakdown ──
const lookup = compileRouter(router)
const sig = new AbortController().signal

console.log('=== Micro breakdown ===')

// 1. URL parse
bench('URL parse', () => {
  const url = 'http://127.0.0.1:4400/greet'
  const ps = url.indexOf('/', url.indexOf('//') + 2)
  const q = url.indexOf('?', ps)
  return q === -1 ? url.slice(ps) : url.slice(ps, q)
})

// 2. Router lookup
bench('Router lookup', () => lookup('POST', '/greet'))

// 3. Object.create(null)
bench('Object.create(null)', () => Object.create(null))

// 4. Pipeline (guard + zod + resolve)
const match = lookup('POST', '/greet')!
const input = { name: 'Alice' }
bench('Pipeline (sync)', () => {
  const ctx: any = { db: 'postgres' }
  return match.data.handler(ctx, input, sig)
})

// 5. Stringify
const out = { hello: 'Alice', by: 1 }
bench('Stringify', () => match.data.stringify(out))

// 6. new Response
const hdr = { 'content-type': 'application/json' }
const str = '{"hello":"Alice","by":1}'
bench('new Response(str, hdr)', () => new Response(str, { headers: hdr }))

// 7. request.json()
await benchAsync('request.json()', async () => {
  const r = req()
  return await r.json()
})

// 8. new Request creation
bench('new Request()', () => req())

console.log('')
console.log('=== Full handler ===')
await benchAsync('Silgi (bun adapter)', () => bunConfig.fetch(req()))
await benchAsync('Elysia', () => app.fetch(req()))
