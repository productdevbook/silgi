import { cacheQuery, invalidateQueryCache } from 'silgi/cache'
import { z } from 'zod'

import { s } from '../instance'

// ── Wrap middleware: timing ─────────────────────────

const timingWrap = s.wrap(async (_ctx, next) => {
  const start = performance.now()
  const result = await next()
  const ms = performance.now() - start
  console.log(`[timing] ${ms.toFixed(2)}ms`)
  return result
})

export const slow = s
  .$route({ ws: true })
  .$use(timingWrap)
  .$resolve(async () => {
    await new Promise((r) => setTimeout(r, 100))
    return { message: 'Done after 100ms', timestamp: Date.now() }
  })

// ── HTTP Cache (Cache-Control header) ──────────────

export const httpCached = s.$route({ cache: 5 }).$resolve(() => ({
  value: Math.random(),
  generatedAt: new Date().toISOString(),
  type: 'http',
  note: 'Cache-Control: public, max-age=5 — browser/CDN only',
}))

// ── Server Cache (ocache — in-memory, Redis, etc.) ─

let dbCallCount = 0

export const serverCached = s.$use(cacheQuery({ maxAge: 10, name: 'expensive-query' })).$resolve(async () => {
  dbCallCount++
  await new Promise((r) => setTimeout(r, 50))
  return {
    value: Math.random(),
    dbCalls: dbCallCount,
    generatedAt: new Date().toISOString(),
    type: 'server',
    note: 'ocache: 10s TTL, SWR enabled — same result for repeated calls',
  }
})

export const invalidateCache = s.$resolve(async () => {
  await invalidateQueryCache('expensive-query')
  return { ok: true, message: 'Cache invalidated' }
})

// ── Subscription / SSE ─────────────────────────────

export const clock = s
  .subscription()
  .$route({ ws: true })
  .$resolve(async function* () {
    for (let i = 0; i < 10; i++) {
      yield { tick: i + 1, time: new Date().toISOString() }
      await new Promise((r) => setTimeout(r, 1000))
    }
  })

// ── Input validation demo ──────────────────────────

export const compute = s
  .$route({ ws: true })
  .$input(
    z.object({
      a: z.number(),
      b: z.number(),
      op: z.enum(['add', 'sub', 'mul', 'div']),
    }),
  )
  .$resolve(({ input }) => {
    const { a, b, op } = input
    const ops: Record<string, number> = {
      add: a + b,
      sub: a - b,
      mul: a * b,
      div: b !== 0 ? a / b : 0,
    }
    return { result: ops[op]!, expression: `${a} ${op} ${b} = ${ops[op]!}` }
  })
