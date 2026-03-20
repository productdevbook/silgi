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

export const slow = s.$use(timingWrap).$resolve(async () => {
  await new Promise((r) => setTimeout(r, 100))
  return { message: 'Done after 100ms', timestamp: Date.now() }
})

// ── Cache demo ─────────────────────────────────────

export const cached = s.$route({ cache: 5 }).$resolve(() => ({
  value: Math.random(),
  generatedAt: new Date().toISOString(),
  note: 'This value is cached for 5 seconds (Cache-Control: public, max-age=5)',
}))

// ── Subscription / SSE ─────────────────────────────

export const clock = s.subscription(async function* () {
  for (let i = 0; i < 10; i++) {
    yield { tick: i + 1, time: new Date().toISOString() }
    await new Promise((r) => setTimeout(r, 1000))
  }
})

// ── Input coercion demo ────────────────────────────

export const compute = s
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
