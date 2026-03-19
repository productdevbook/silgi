/**
 * Cache plugin — production-grade response caching powered by ocache.
 *
 * Features:
 * - TTL + Stale-While-Revalidate (SWR)
 * - Request deduplication (concurrent calls share one in-flight promise)
 * - Automatic integrity (redeploy invalidates stale cache)
 * - Pluggable storage via `setCacheStorage()` (default: in-memory)
 * - unstorage adapter for Redis, Cloudflare KV, S3, etc.
 * - Mutation-triggered invalidation
 *
 * @example
 * ```ts
 * import { cacheQuery, setCacheStorage } from 'katman/cache'
 *
 * // Basic: cache for 60 seconds with SWR
 * const listUsers = k.query({
 *   use: [cacheQuery({ maxAge: 60 })],
 *   resolve: ({ ctx }) => ctx.db.users.findMany(),
 * })
 *
 * // With unstorage backend (Redis)
 * import { createUnstorageAdapter } from 'katman/cache'
 * import { createStorage } from 'unstorage'
 * import redisDriver from 'unstorage/drivers/redis'
 *
 * const storage = createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 * setCacheStorage(createUnstorageAdapter(storage))
 * ```
 */

import { defineCachedFunction, setStorage, useStorage } from 'ocache'
import { hash } from 'ohash'

import type { CacheOptions, StorageInterface } from 'ocache'
import type { WrapDef } from '../types.ts'

/** Registry of cached function keys for invalidation */
const cacheKeyRegistry = new Map<string, Set<string>>()

// ── Cache Query Wrap ────────────────────────────────

export interface CacheQueryOptions {
  /** Cache TTL in seconds (default: 60) */
  maxAge?: number
  /** Enable stale-while-revalidate (default: true) */
  swr?: boolean
  /** Max seconds to serve stale while revalidating (default: maxAge) */
  staleMaxAge?: number
  /** Custom cache key generator from input */
  getKey?: (input: unknown) => string
  /** Cache key name prefix (default: procedure path, set automatically) */
  name?: string
}

/**
 * Wrap middleware that caches query results.
 *
 * Uses ocache under the hood: TTL, SWR, dedup, integrity.
 * Default: 60s TTL, SWR enabled.
 *
 * @example
 * ```ts
 * const listUsers = k.query({
 *   use: [cacheQuery({ maxAge: 60 })],
 *   resolve: ({ ctx }) => ctx.db.users.findMany(),
 * })
 * ```
 */
export function cacheQuery(options: CacheQueryOptions = {}): WrapDef {
  const maxAge = options.maxAge ?? 60
  const swr = options.swr ?? true
  const staleMaxAge = options.staleMaxAge ?? maxAge
  const customGetKey = options.getKey

  let cacheName = options.name

  // Shared mutable ref — wrap captures `currentNext`, cachedFn calls it
  let currentNext: (() => Promise<unknown>) | null = null

  // Each procedure gets its own cachedFn (lazy init on first call)
  let cachedFn: ReturnType<typeof defineCachedFunction> | null = null

  return {
    kind: 'wrap',
    fn: async (ctx, next) => {
      if (!cachedFn) {
        if (!cacheName) {
          cacheName = (ctx as any).__procedurePath || `proc_${hash(next.toString()).slice(0, 8)}`
        }
        const resolvedName = cacheName
        const keySet = new Set<string>()
        cacheKeyRegistry.set(resolvedName, keySet)

        const keyFn = customGetKey
          ? (input: unknown) => customGetKey(input)
          : (input: unknown) => (input !== undefined && input !== null ? hash(input) : '')

        cachedFn = defineCachedFunction(
          async (_input: unknown) => currentNext!(),
          {
            name: resolvedName,
            group: 'katman',
            maxAge,
            swr,
            staleMaxAge,
            getKey: (input: unknown) => {
              const key = keyFn(input)
              keySet.add(`/cache:katman:${resolvedName}:${key}.json`)
              return key
            },
          },
        )
      }

      // Set the current request's next() before calling cachedFn
      currentNext = next
      const input = (ctx as any).__rawInput
      return cachedFn(input)
    },
  }
}

// ── Cache Invalidation ──────────────────────────────

/**
 * Invalidate cached entries for a procedure by name.
 *
 * Call this after mutations to clear related query caches.
 *
 * @example
 * ```ts
 * const createUser = k.mutation({
 *   resolve: async ({ input, ctx }) => {
 *     const user = await ctx.db.users.create(input)
 *     await invalidateQueryCache('users_list')
 *     return user
 *   },
 * })
 * ```
 */
export async function invalidateQueryCache(name: string): Promise<void> {
  const keys = cacheKeyRegistry.get(name)
  if (keys) {
    const storage = useStorage()
    await Promise.all([...keys].map((key) => storage.set(key, null)))
    keys.clear()
  }
}

// ── Storage Configuration ───────────────────────────

/**
 * Set the cache storage backend.
 *
 * Default: in-memory Map with TTL.
 * For production, use `createUnstorageAdapter()` with Redis, Cloudflare KV, etc.
 *
 * @example
 * ```ts
 * import { setCacheStorage, createUnstorageAdapter } from 'katman/cache'
 * import { createStorage } from 'unstorage'
 * import redisDriver from 'unstorage/drivers/redis'
 *
 * setCacheStorage(createUnstorageAdapter(
 *   createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 * ))
 * ```
 */
export function setCacheStorage(storage: StorageInterface): void {
  setStorage(storage)
}

// ── unstorage Adapter ───────────────────────────────

/**
 * Minimal interface matching unstorage's Storage.
 * Avoids hard dependency on unstorage — users bring their own.
 */
export interface UnstorageCompatible {
  getItem<T = unknown>(key: string): Promise<T | null> | T | null
  setItem(key: string, value: unknown, opts?: { ttl?: number }): Promise<void> | void
  removeItem(key: string): Promise<void> | void
}

/**
 * Create an ocache-compatible storage adapter from an unstorage instance.
 *
 * @example
 * ```ts
 * import { createStorage } from 'unstorage'
 * import redisDriver from 'unstorage/drivers/redis'
 *
 * const storage = createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 * const adapter = createUnstorageAdapter(storage)
 * setCacheStorage(adapter)
 * ```
 */
export function createUnstorageAdapter(storage: UnstorageCompatible): StorageInterface {
  return {
    get: (key) => storage.getItem(key),
    set: (key, value, opts) => {
      if (value === null || value === undefined) {
        return storage.removeItem(key) as any
      }
      return storage.setItem(key, value, opts) as any
    },
  }
}

// ── Re-exports ──────────────────────────────────────

export type { StorageInterface, CacheOptions }
