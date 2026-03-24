import { describe, expect, it, vi } from 'vitest'

import { isLazy, lazy, resolveLazy } from '#src/lazy.ts'

describe('lazy', () => {
  it('creates a LazyRouter with __lazy flag', () => {
    const l = lazy(() => Promise.resolve({ default: {} }))
    expect(l.__lazy).toBe(true)
    expect(typeof l.load).toBe('function')
  })
})

describe('isLazy', () => {
  it('returns true for lazy routers', () => {
    const l = lazy(() => Promise.resolve({ default: {} }))
    expect(isLazy(l)).toBe(true)
  })

  it('returns false for plain objects', () => {
    expect(isLazy({})).toBe(false)
    expect(isLazy({ __lazy: false })).toBe(false)
  })

  it('returns false for non-objects', () => {
    expect(isLazy(null)).toBe(false)
    expect(isLazy(42)).toBe(false)
    expect(isLazy('lazy')).toBe(false)
  })
})

describe('resolveLazy', () => {
  it('resolves and caches the module default', async () => {
    const routerDef = { hello: { type: 'query', resolve: () => 'hi' } }
    const loader = vi.fn(() => Promise.resolve({ default: routerDef }))
    const l = lazy(loader)

    const result = await resolveLazy(l)
    expect(result).toBe(routerDef)

    // Second call should use cache — loader only called once
    const result2 = await resolveLazy(l)
    expect(result2).toBe(routerDef)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('propagates loader errors', async () => {
    const l = lazy(() => Promise.reject(new Error('import failed')))
    await expect(resolveLazy(l)).rejects.toThrow('import failed')
  })
})
