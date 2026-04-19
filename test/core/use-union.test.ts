/**
 * $use() — union overload accepts `GuardDef | WrapDef` at boundary points.
 */

import { describe, it, expect } from 'vitest'

import { silgi } from '#src/silgi.ts'

import type { MiddlewareDef } from '#src/types.ts'

describe('$use union overload', () => {
  it('accepts a GuardDef | WrapDef value without discriminating the variant', async () => {
    const k = silgi({ context: () => ({ db: 'x' as const }) })

    const guard = k.guard(() => ({ userId: 1 }))
    const wrap = k.wrap(async (_ctx, next) => next())

    // Caller sees them through a union boundary (e.g. injected through DI):
    const mws: MiddlewareDef[] = [guard, wrap]

    const b = k.$resolve(() => 'root')
    expect(b).toBeDefined()

    // Each passes through $use without TS error (compile-time guarantee).
    let chain = k.$route({}) as any
    for (const mw of mws) chain = chain.$use(mw)
    const proc = chain.$resolve(() => 'ok')

    const caller = k.createCaller(k.router({ proc }))
    expect(await caller.proc()).toBe('ok')
  })
})
