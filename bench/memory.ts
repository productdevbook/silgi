/**
 * Memory benchmark — Katman vs oRPC baseline + per-request allocation.
 *
 * Run: node --experimental-strip-types --expose-gc bench/memory.ts
 */

import { z } from 'zod'

// Force GC for accurate measurement
const gc = globalThis.gc
if (!gc) {
  console.error('Run with --expose-gc flag: node --expose-gc --experimental-strip-types bench/memory.ts')
  process.exit(1)
}

const InputSchema = z.object({ name: z.string(), age: z.number() })
const testInput = { name: 'Alice', age: 30 }

// ── Katman ──────────────────────────────────────────

import { compileProcedure } from '../src/compile.ts'

import type { GuardDef } from '../src/types.ts'

const katmanProc = compileProcedure({
  type: 'mutation',
  input: InputSchema as any,
  output: null,
  errors: null,
  use: [
    { kind: 'guard', fn: () => ({ a: 1 }) } as GuardDef,
    { kind: 'guard', fn: () => ({ b: 2 }) } as GuardDef,
    { kind: 'guard', fn: () => ({ c: 3 }) } as GuardDef,
  ],
  resolve: async ({ input }: any) => input,
  route: null,
})

// ── oRPC ────────────────────────────────────────────

import { os as orpcOs } from '@orpc/server'
import { createRouterClient } from '@orpc/server'

const orpcProc = orpcOs
  .use(async ({ next }) => next({ context: { a: 1 } }))
  .use(async ({ next }) => next({ context: { b: 2 } }))
  .use(async ({ next }) => next({ context: { c: 3 } }))
  .input(InputSchema)
  .handler(async ({ input }) => input)
const orpcClient = createRouterClient({ p: orpcProc }, { context: {} })

// ── Measurement ─────────────────────────────────────

async function measureMemory(name: string, fn: () => Promise<unknown>, runs: number) {
  // Warmup
  for (let i = 0; i < 1000; i++) await fn()
  gc!()

  const before = process.memoryUsage()
  for (let i = 0; i < runs; i++) await fn()
  const after = process.memoryUsage()
  gc!()
  const final = process.memoryUsage()

  const heapDelta = after.heapUsed - before.heapUsed
  const perCall = heapDelta / runs

  console.log(`${name}:`)
  console.log(`  Heap before: ${(before.heapUsed / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  Heap after:  ${(after.heapUsed / 1024 / 1024).toFixed(1)} MB`)
  console.log(`  Heap delta:  ${(heapDelta / 1024).toFixed(1)} KB`)
  console.log(`  Per call:    ${perCall.toFixed(0)} bytes`)
  console.log(`  After GC:    ${(final.heapUsed / 1024 / 1024).toFixed(1)} MB`)
  return { heapDelta, perCall }
}

const signal = AbortSignal.timeout(30_000)
const RUNS = 50_000

console.log(`\nMemory Benchmark — ${RUNS} calls, 3 guards + Zod validation\n`)

const katmanMem = await measureMemory('Katman', () => katmanProc({}, testInput, signal), RUNS)

console.log()

const orpcMem = await measureMemory('oRPC', () => (orpcClient as any).p(testInput), RUNS)

console.log(`\n─────────────────────────────────────`)
console.log(`Memory ratio: oRPC uses ${(orpcMem.perCall / katmanMem.perCall).toFixed(1)}x more per call`)
console.log(`  Katman: ${katmanMem.perCall.toFixed(0)} bytes/call`)
console.log(`  oRPC:   ${orpcMem.perCall.toFixed(0)} bytes/call`)

process.exit(0)
