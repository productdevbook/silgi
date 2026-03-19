/**
 * Benchmark: oRPC vs Katman v2
 *
 * Fair comparison — same middleware chain, same schemas, same handler logic.
 * Measures pure pipeline execution overhead (no HTTP, no serialization).
 *
 * Run: node --experimental-strip-types bench/vs-orpc.ts
 */

import { os } from '@orpc/server'
import { createRouterClient as orpcRouterClient } from '@orpc/server'
// ── oRPC Setup ──────────────────────────────────────
import { bench, run, summary } from 'mitata'
import { z } from 'zod'
// ── Katman v2 Setup ─────────────────────────────────

import { compileProcedure } from '../src/compile.ts'
import { katman } from '../src/katman.ts'

import type { GuardDef, WrapDef } from '../src/types.ts'

// ── Shared Schema ───────────────────────────────────

const InputSchema = z.object({ name: z.string(), age: z.number() })
const OutputSchema = z.object({ greeting: z.string(), doubled: z.number() })
const testInput = { name: 'Alice', age: 30 }
const signal = AbortSignal.timeout(30_000)

// ═══════════════════════════════════════════════════
//  Scenario 1: Simple — no middleware, no validation
// ═══════════════════════════════════════════════════

// oRPC
const orpc_simple = os.handler(async ({ input }) => ({
  greeting: `Hello ${(input as any)?.name}`,
  doubled: ((input as any)?.age ?? 0) * 2,
}))
const orpc_simple_client = orpcRouterClient({ proc: orpc_simple }, { context: {} })

// Katman v2
const k = katman({ context: () => ({}) })
const katman_simple = compileProcedure({
  type: 'query',
  input: null,
  output: null,
  errors: null,
  use: null,
  resolve: async ({ input }: any) => ({
    greeting: `Hello ${input?.name}`,
    doubled: (input?.age ?? 0) * 2,
  }),
  route: null,
})

// ═══════════════════════════════════════════════════
//  Scenario 2: With Zod input validation
// ═══════════════════════════════════════════════════

// oRPC
const orpc_validated = os.input(InputSchema).handler(async ({ input }) => ({
  greeting: `Hello ${input.name}`,
  doubled: input.age * 2,
}))
const orpc_validated_client = orpcRouterClient({ proc: orpc_validated }, { context: {} })

// Katman v2
const katman_validated = compileProcedure({
  type: 'query',
  input: InputSchema as any,
  output: null,
  errors: null,
  use: null,
  resolve: async ({ input }: any) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }),
  route: null,
})

// ═══════════════════════════════════════════════════
//  Scenario 3: 3 middleware + validation (realistic)
// ═══════════════════════════════════════════════════

// oRPC: 3 chained middlewares
const orpc_full = os
  .use(async ({ next }) => next({ context: { user: { id: 1 } } }))
  .use(async ({ next }) => next({ context: { permissions: ['read', 'write'] } }))
  .use(async ({ next }) => next({ context: { requestId: 'req-123' } }))
  .input(InputSchema)
  .handler(async ({ input, context }) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }))
const orpc_full_client = orpcRouterClient({ proc: orpc_full }, { context: {} })

// Katman v2: 3 guards (flat) + validation
const katman_full = compileProcedure({
  type: 'mutation',
  input: InputSchema as any,
  output: null,
  errors: null,
  use: [
    { kind: 'guard', fn: () => ({ user: { id: 1 } }) } as GuardDef,
    { kind: 'guard', fn: () => ({ permissions: ['read', 'write'] }) } as GuardDef,
    { kind: 'guard', fn: () => ({ requestId: 'req-123' }) } as GuardDef,
  ],
  resolve: async ({ input, ctx }: any) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }),
  route: null,
})

// ═══════════════════════════════════════════════════
//  Scenario 4: 5 middleware + validation (heavy)
// ═══════════════════════════════════════════════════

// oRPC: 5 chained middlewares (3 context + 2 wrap-like)
const orpc_heavy = os
  .use(async ({ next }) => next({ context: { user: { id: 1 } } }))
  .use(async ({ next }) => next({ context: { permissions: ['read'] } }))
  .use(async ({ next }) => next({ context: { requestId: 'req-123' } }))
  .use(async ({ next }) => {
    const r = await next()
    return r
  }) // timing-like
  .use(async ({ next }) => {
    const r = await next()
    return r
  }) // logging-like
  .input(InputSchema)
  .handler(async ({ input }) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }))
const orpc_heavy_client = orpcRouterClient({ proc: orpc_heavy }, { context: {} })

// Katman v2: 3 guards + 2 wraps + validation
const katman_heavy = compileProcedure({
  type: 'mutation',
  input: InputSchema as any,
  output: null,
  errors: null,
  use: [
    { kind: 'guard', fn: () => ({ user: { id: 1 } }) } as GuardDef,
    { kind: 'guard', fn: () => ({ permissions: ['read'] }) } as GuardDef,
    { kind: 'guard', fn: () => ({ requestId: 'req-123' }) } as GuardDef,
    { kind: 'wrap', fn: async (_: any, next: any) => next() } as WrapDef,
    { kind: 'wrap', fn: async (_: any, next: any) => next() } as WrapDef,
  ],
  resolve: async ({ input }: any) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }),
  route: null,
})

// ═══════════════════════════════════════════════════
//  Scenario 5: Input + Output validation
// ═══════════════════════════════════════════════════

// oRPC
const orpc_io = os
  .input(InputSchema)
  .output(OutputSchema)
  .handler(async ({ input }) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }))
const orpc_io_client = orpcRouterClient({ proc: orpc_io }, { context: {} })

// Katman v2
const katman_io = compileProcedure({
  type: 'query',
  input: InputSchema as any,
  output: OutputSchema as any,
  errors: null,
  use: null,
  resolve: async ({ input }: any) => ({
    greeting: `Hello ${input.name}`,
    doubled: input.age * 2,
  }),
  route: null,
})

// ═══════════════════════════════════════════════════
//  Run
// ═══════════════════════════════════════════════════

console.log('oRPC vs Katman v2 — Pipeline Performance\n')

summary(() => {
  bench('oRPC  — no middleware', async () => {
    await (orpc_simple_client as any).proc(testInput)
  })
  bench('Katman — no middleware', async () => {
    await katman_simple({}, testInput, signal)
  })
})

summary(() => {
  bench('oRPC  — Zod input validation', async () => {
    await (orpc_validated_client as any).proc(testInput)
  })
  bench('Katman — Zod input validation', async () => {
    await katman_validated({}, testInput, signal)
  })
})

summary(() => {
  bench('oRPC  — 3 middleware + Zod', async () => {
    await (orpc_full_client as any).proc(testInput)
  })
  bench('Katman — 3 guards + Zod', async () => {
    await katman_full({}, testInput, signal)
  })
})

summary(() => {
  bench('oRPC  — 5 middleware + Zod', async () => {
    await (orpc_heavy_client as any).proc(testInput)
  })
  bench('Katman — 3 guards + 2 wraps + Zod', async () => {
    await katman_heavy({}, testInput, signal)
  })
})

summary(() => {
  bench('oRPC  — input + output Zod validation', async () => {
    await (orpc_io_client as any).proc(testInput)
  })
  bench('Katman — input + output Zod validation', async () => {
    await katman_io({}, testInput, signal)
  })
})

await run()
