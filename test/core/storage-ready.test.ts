import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, describe, expect, it } from 'vitest'

import { resetStorage } from '#src/core/storage.ts'
import { silgi } from '#src/silgi.ts'

afterEach(() => resetStorage())

describe('silgi.ready() — storage init lifecycle', () => {
  it('resolves immediately when no storage is configured', async () => {
    const k = silgi({ context: () => ({}) })
    await expect(k.ready()).resolves.toBeUndefined()
  })

  it('resolves after initStorage when a driver is configured', async () => {
    const k = silgi({
      context: () => ({}),
      storage: { cache: memoryDriver() },
    })
    await expect(k.ready()).resolves.toBeUndefined()
  })

  it('ready() returns the same promise on every call', () => {
    const k = silgi({ context: () => ({}) })
    expect(k.ready()).toBe(k.ready())
  })

  it('useStorage() is correctly ordered even without an explicit ready() call', async () => {
    const k = silgi({
      context: () => ({}),
      storage: { cache: memoryDriver() },
    })
    const store = await k.useStorage('cache')
    await store.setItem('smoke', 'ok')
    expect(await store.getItem('smoke')).toBe('ok')
  })
})
