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

  it('does not cache rejections — retries succeed after a transient failure', async () => {
    const routerDef = { hello: { type: 'query', resolve: () => 'hi' } }
    let attempt = 0
    const loader = vi.fn(() => {
      attempt++
      if (attempt === 1) return Promise.reject(new Error('transient'))
      return Promise.resolve({ default: routerDef })
    })
    const l = lazy(loader)

    await expect(resolveLazy(l)).rejects.toThrow('transient')
    // Second call must retry — not see the cached rejection
    const result = await resolveLazy(l)
    expect(result).toBe(routerDef)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('concurrent callers during a rejection all see the error, then next call retries', async () => {
    let attempt = 0
    const loader = vi.fn(() => {
      attempt++
      if (attempt === 1) return Promise.reject(new Error('boom'))
      return Promise.resolve({ default: { ok: true } as any })
    })
    const l = lazy(loader)

    // Two concurrent calls share the first in-flight rejection
    const [a, b] = await Promise.allSettled([resolveLazy(l), resolveLazy(l)])
    expect(a.status).toBe('rejected')
    expect(b.status).toBe('rejected')
    expect(loader).toHaveBeenCalledTimes(1)

    // After settle, a fresh call retries
    const ok = await resolveLazy(l)
    expect((ok as any).ok).toBe(true)
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
