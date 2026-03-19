import { describe, expect, it } from 'vitest'

import { ContextPool } from '#src/compile.ts'

describe('ContextPool', () => {
  it('borrows a null-prototype object', () => {
    const pool = new ContextPool(2)
    const ctx = pool.borrow()
    expect(Object.getPrototypeOf(ctx)).toBeNull()
    expect(Object.keys(ctx)).toHaveLength(0)
  })

  it('does not leak properties between borrow/release cycles', () => {
    const pool = new ContextPool(2)

    // First borrow — add properties
    const ctx1 = pool.borrow()
    ctx1.secret = 'sensitive-data'
    ctx1.user = { id: 1 }
    pool.release(ctx1)

    // Second borrow — should get a clean object
    const ctx2 = pool.borrow()
    expect(ctx2.secret).toBeUndefined()
    expect(ctx2.user).toBeUndefined()
    expect(Object.keys(ctx2)).toHaveLength(0)
  })

  it('falls back to new object when pool is exhausted', () => {
    const pool = new ContextPool(1)
    const ctx1 = pool.borrow()
    // Pool now exhausted
    const ctx2 = pool.borrow()
    // Should still get a usable object
    expect(Object.getPrototypeOf(ctx2)).toBeNull()
    expect(ctx1).not.toBe(ctx2)
  })

  it('returns a fresh clean object after release', () => {
    const pool = new ContextPool(1)
    const ctx1 = pool.borrow()
    ctx1.leaked = 'data'
    pool.release(ctx1)
    const ctx2 = pool.borrow()
    // After fix: release creates a fresh object (avoids V8 dictionary mode from delete)
    expect(Object.keys(ctx2)).toHaveLength(0)
    expect(ctx2.leaked).toBeUndefined()
  })
})
