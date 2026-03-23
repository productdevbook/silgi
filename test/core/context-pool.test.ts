import { describe, expect, it } from 'vitest'

import { createContext } from '#src/compile.ts'

describe('createContext', () => {
  it('returns a null-prototype object', () => {
    const ctx = createContext()
    expect(Object.getPrototypeOf(ctx)).toBeNull()
    expect(Object.keys(ctx)).toHaveLength(0)
  })

  it('returns a fresh object each time', () => {
    const ctx1 = createContext()
    const ctx2 = createContext()
    expect(ctx1).not.toBe(ctx2)
  })

  it('does not share properties between contexts', () => {
    const ctx1 = createContext()
    ctx1.secret = 'sensitive-data'
    ctx1.user = { id: 1 }

    const ctx2 = createContext()
    expect(ctx2.secret).toBeUndefined()
    expect(ctx2.user).toBeUndefined()
    expect(Object.keys(ctx2)).toHaveLength(0)
  })
})
