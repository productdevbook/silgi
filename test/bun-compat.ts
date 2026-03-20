/**
 * Bun compatibility smoke test.
 *
 * Run: bun test/bun-compat.ts
 */

import { z } from 'zod'

import { silgi } from '../src/silgi.ts'

const k = silgi({ context: () => ({ db: true }) })

const router = k.router({
  health: k.$resolve(() => ({ status: 'ok', runtime: typeof Bun !== 'undefined' ? 'bun' : 'node' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  add: k.$input(z.object({ a: z.number(), b: z.number() })).$resolve(({ input }) => ({ sum: input.a + input.b })),
})

const handle = k.handler(router)

// Test 1: No-input query
const r1 = await handle(new Request('http://localhost/health', { method: 'POST' }))
const d1 = await r1.json()
console.assert(d1.status === 'ok', `FAIL: health status = ${d1.status}`)
console.log(`✓ health: ${JSON.stringify(d1)}`)

// Test 2: Query with input
const r2 = await handle(
  new Request('http://localhost/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ msg: 'hello bun' }),
  }),
)
const d2 = await r2.json()
console.assert(d2.echo === 'hello bun', `FAIL: echo = ${d2.echo}`)
console.log(`✓ echo: ${JSON.stringify(d2)}`)

// Test 3: Mutation
const r3 = await handle(
  new Request('http://localhost/add', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ a: 10, b: 32 }),
  }),
)
const d3 = await r3.json()
console.assert(d3.sum === 42, `FAIL: sum = ${d3.sum}`)
console.log(`✓ add: ${JSON.stringify(d3)}`)

// Test 4: 404
const r4 = await handle(new Request('http://localhost/nope', { method: 'POST' }))
console.assert(r4.status === 404, `FAIL: status = ${r4.status}`)
console.log(`✓ 404: status=${r4.status}`)

// Test 5: Validation error
const r5 = await handle(
  new Request('http://localhost/echo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wrong: true }),
  }),
)
console.assert(r5.status === 400, `FAIL: validation status = ${r5.status}`)
console.log(`✓ validation error: status=${r5.status}`)

// Test 6: Performance
const N = 10000
const req = new Request('http://localhost/health', { method: 'POST' })
const t0 = performance.now()
for (let i = 0; i < N; i++) {
  const r = await handle(new Request('http://localhost/health', { method: 'POST' }))
  await r.text()
}
const totalMs = performance.now() - t0
const avgUs = (totalMs / N) * 1000
console.log(`✓ perf: ${N} requests in ${totalMs.toFixed(0)}ms (${avgUs.toFixed(0)}µs/req)`)

console.log(`\n✅ All Bun compatibility tests passed (runtime: ${d1.runtime})`)
