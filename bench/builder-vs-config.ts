/**
 * Benchmark: Builder vs Config form procedure creation + execution
 *
 * Measures:
 * 1. Procedure creation time (builder chain vs config object)
 * 2. Compiled handler execution time (should be identical)
 *
 * Run: node --experimental-strip-types bench/builder-vs-config.ts
 */

import { bench, run, summary, compact } from 'mitata'
import { z } from 'zod'

import { katman } from '../src/katman.ts'
import { compileProcedure } from '../src/compile.ts'

const k = katman({ context: () => ({ db: true }) })

const inputSchema = z.object({ name: z.string(), age: z.number() })
const outputSchema = z.object({ id: z.number(), name: z.string(), age: z.number() })
const signal = AbortSignal.timeout(30_000)
const testInput = { name: 'Alice', age: 30 }

const auth = k.guard(() => ({ userId: 1 }))
const timing = k.wrap(async (_ctx, next) => next())

// ═══════════════════════════════════════════════════
//  Procedure Creation
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('config: simple query', () => {
      k.query(inputSchema, ({ input }) => ({ id: 1, ...input }))
    })

    bench('builder: simple query', () => {
      k.query()
        .input(inputSchema)
        .resolve(({ input }) => ({ id: 1, ...input }))
    })
  })
})

summary(() => {
  compact(() => {
    bench('config: full (use + input + output + errors)', () => {
      k.mutation({
        use: [auth, timing],
        input: inputSchema,
        output: outputSchema,
        errors: { CONFLICT: 409 },
        resolve: ({ input }) => ({ id: 1, name: input.name, age: input.age }),
      })
    })

    bench('builder: full (use + input + output + errors)', () => {
      k.mutation()
        .use(auth, timing)
        .input(inputSchema)
        .output(outputSchema)
        .errors({ CONFLICT: 409 })
        .resolve(({ input }) => ({ id: 1, name: input.name, age: input.age }))
    })
  })
})

// ═══════════════════════════════════════════════════
//  Compiled Handler Execution (should be identical)
// ═══════════════════════════════════════════════════

const configProc = k.mutation({
  use: [auth, timing],
  input: inputSchema,
  output: outputSchema,
  errors: { CONFLICT: 409 },
  resolve: ({ input }) => ({ id: 1, name: input.name, age: input.age }),
})

const builderProc = k.mutation()
  .use(auth, timing)
  .input(inputSchema)
  .output(outputSchema)
  .errors({ CONFLICT: 409 })
  .resolve(({ input }) => ({ id: 1, name: input.name, age: input.age }))

const configHandler = compileProcedure(configProc)
const builderHandler = compileProcedure(builderProc)

summary(() => {
  compact(() => {
    bench('execute: config-created handler', async () => {
      const ctx: Record<string, unknown> = { db: true }
      await configHandler(ctx, testInput, signal)
    })

    bench('execute: builder-created handler', async () => {
      const ctx: Record<string, unknown> = { db: true }
      await builderHandler(ctx, testInput, signal)
    })
  })
})

await run()
