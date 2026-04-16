import { describe, expect, it } from 'vitest'

import { silgi } from '#src/silgi.ts'

describe('multi-instance context isolation', () => {
  it('two silgi instances do not share ambient context', async () => {
    const k1 = silgi({ context: () => ({ tag: 'k1' as const }) })
    const k2 = silgi({ context: () => ({ tag: 'k2' as const }) })

    const ctx1 = { tag: 'k1' as const, value: 'from-k1' }
    const ctx2 = { tag: 'k2' as const, value: 'from-k2' }

    let seen1: unknown
    let seen2: unknown
    let crossTalk1: unknown
    let crossTalk2: unknown

    await Promise.all([
      k1.runInContext(ctx1, async () => {
        await new Promise<void>((r) => setTimeout(r, 10))
        seen1 = k1.currentContext()
        crossTalk1 = k2.currentContext()
      }),
      k2.runInContext(ctx2, async () => {
        await new Promise<void>((r) => setTimeout(r, 5))
        seen2 = k2.currentContext()
        crossTalk2 = k1.currentContext()
      }),
    ])

    expect(seen1).toEqual(ctx1)
    expect(seen2).toEqual(ctx2)
    expect(crossTalk1).toBeUndefined()
    expect(crossTalk2).toBeUndefined()
  })

  it('runInContext is instance-scoped', () => {
    const k1 = silgi({ context: () => ({}) })
    const k2 = silgi({ context: () => ({}) })

    const sharedCtx = { user: 'alice' }

    k1.runInContext(sharedCtx, () => {
      expect(k1.currentContext()).toBe(sharedCtx)
      expect(k2.currentContext()).toBeUndefined()
    })
  })

  it('currentContext returns undefined outside runInContext', () => {
    const k = silgi({ context: () => ({}) })
    expect(k.currentContext()).toBeUndefined()
  })

  it('runInContext returns the value produced by fn', () => {
    const k = silgi({ context: () => ({}) })
    const result = k.runInContext({ x: 1 }, () => 42)
    expect(result).toBe(42)
  })
})
