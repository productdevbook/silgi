import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

import { katman } from '#src/katman.ts'
import { cacheQuery, setCacheStorage, invalidateQueryCache, createUnstorageAdapter } from '#src/plugins/cache.ts'
import { createMemoryStorage, setStorage } from 'ocache'

const k = katman({ context: () => ({}) })

beforeEach(() => {
  // Reset to fresh memory storage before each test
  setStorage(createMemoryStorage())
})

describe('cacheQuery', () => {
  it('caches query results — second call returns cached value', async () => {
    let callCount = 0

    const handler = k.handler(
      k.router({
        counter: k.query({
          use: [cacheQuery({ maxAge: 10 })],
          resolve: () => ++callCount,
        }),
      }),
    )

    const res1 = await handler(new Request('http://localhost/counter', { method: 'POST' }))
    const val1 = await res1.json()
    expect(val1).toBe(1)

    const res2 = await handler(new Request('http://localhost/counter', { method: 'POST' }))
    const val2 = await res2.json()
    expect(val2).toBe(1) // cached, not 2

    expect(callCount).toBe(1) // resolver only called once
  })

  it('different inputs produce different cache entries', async () => {
    let callCount = 0

    const handler = k.handler(
      k.router({
        echo: k.query({
          use: [cacheQuery({ maxAge: 60, swr: false, name: 'echo_test' })],
          input: z.object({ id: z.number() }),
          resolve: ({ input }) => {
            callCount++
            return { id: input.id, call: callCount }
          },
        }),
      }),
    )

    const makeReq = (id: number) =>
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id }),
      })

    const res1 = await handler(makeReq(1))
    const val1 = await res1.json()
    expect(val1.id).toBe(1)
    expect(val1.call).toBe(1)

    const res2 = await handler(makeReq(2))
    const val2 = await res2.json()
    expect(val2.id).toBe(2)
    expect(val2.call).toBe(2) // different input, different cache

    // Same input as first call — should be cached
    const res3 = await handler(makeReq(1))
    const val3 = await res3.json()
    expect(val3.call).toBe(1) // cached from first call
  })
})

describe('invalidateQueryCache', () => {
  it('invalidates cached entries by name', async () => {
    let callCount = 0

    const handler = k.handler(
      k.router({
        data: k.query({
          use: [cacheQuery({ maxAge: 60, name: 'data_query' })],
          resolve: () => ++callCount,
        }),
      }),
    )

    const res1 = await handler(new Request('http://localhost/data', { method: 'POST' }))
    expect(await res1.json()).toBe(1)

    // Invalidate
    await invalidateQueryCache('data_query')

    const res2 = await handler(new Request('http://localhost/data', { method: 'POST' }))
    expect(await res2.json()).toBe(2) // re-resolved after invalidation
  })
})

describe('createUnstorageAdapter', () => {
  it('adapts unstorage-like interface to ocache StorageInterface', async () => {
    const store = new Map<string, unknown>()
    const fakeUnstorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: unknown) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }

    const adapter = createUnstorageAdapter(fakeUnstorage)

    await adapter.set('test-key', { data: 'hello' })
    const result = await adapter.get('test-key')
    expect(result).toEqual({ data: 'hello' })

    // Setting null removes
    await adapter.set('test-key', null)
    const removed = await adapter.get('test-key')
    expect(removed).toBeNull()
  })

  it('works as cache backend via setCacheStorage', async () => {
    const store = new Map<string, unknown>()
    const fakeUnstorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: unknown) => {
        store.set(key, value)
      },
      removeItem: (key: string) => {
        store.delete(key)
      },
    }

    setCacheStorage(createUnstorageAdapter(fakeUnstorage))

    let callCount = 0
    const handler = k.handler(
      k.router({
        cached: k.query({
          use: [cacheQuery({ maxAge: 60, name: 'unstorage_test' })],
          resolve: () => ++callCount,
        }),
      }),
    )

    const res1 = await handler(new Request('http://localhost/cached', { method: 'POST' }))
    expect(await res1.json()).toBe(1)

    const res2 = await handler(new Request('http://localhost/cached', { method: 'POST' }))
    expect(await res2.json()).toBe(1) // cached via unstorage adapter

    // Verify data is in the fake unstorage
    expect(store.size).toBeGreaterThan(0)
  })
})
