/**
 * Cache plugin — production-grade response caching powered by ocache.
 *
 * All ocache features exposed:
 * - TTL + Stale-While-Revalidate (SWR)
 * - Request deduplication (concurrent calls share one in-flight promise)
 * - Automatic integrity (redeploy invalidates stale cache)
 * - shouldBypassCache / shouldInvalidateCache callbacks
 * - Entry validation and transformation
 * - Multi-tier storage (read cascade, write to all)
 * - Pluggable storage via `setCacheStorage()` (default: in-memory)
 * - unstorage adapter for Redis, Cloudflare KV, S3, etc.
 * - Mutation-triggered invalidation
 *
 * @example
 * ```ts
 * import { cacheQuery, setCacheStorage } from 'silgi/cache'
 *
 * // Basic: cache for 60 seconds with SWR
 * const listUsers = k
 *   .$use(cacheQuery({ maxAge: 60 }))
 *   .$resolve(({ ctx }) => ctx.db.users.findMany())
 *
 * // With unstorage backend (Redis)
 * import { createUnstorageAdapter } from 'silgi/cache'
 * import { createStorage } from 'silgi/unstorage'
 * import redisDriver from 'unstorage/drivers/redis'
 *
 * const storage = createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 * setCacheStorage(createUnstorageAdapter(storage))
 * ```
 */

import { defineCachedFunction, setStorage, useStorage } from 'ocache'
import { hash } from 'ohash'

import type { WrapDef } from '../types.ts'
import type { CacheEntry, CacheOptions, StorageInterface } from 'ocache'

/** Registry of cached function keys for invalidation */
const cacheKeyRegistry = new Map<string, Set<string>>()

// ── Cache Query Wrap ────────────────────────────────

export interface CacheQueryOptions<T = unknown> {
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
  /**
   * When returns `true`, skip cache entirely and call resolver directly.
   * Useful for admin users or debug modes.
   *
   * @example
   * ```ts
   * cacheQuery({
   *   shouldBypassCache: (input) => input?.noCache === true,
   * })
   * ```
   */
  shouldBypassCache?: (input: unknown) => boolean | Promise<boolean>
  /**
   * When returns `true`, invalidate cache for this key and re-resolve.
   * The new result is cached normally.
   *
   * @example
   * ```ts
   * cacheQuery({
   *   shouldInvalidateCache: (input) => input?.refresh === true,
   * })
   * ```
   */
  shouldInvalidateCache?: (input: unknown) => boolean | Promise<boolean>
  /**
   * Validate a cache entry before returning it.
   * Return `false` to treat as cache miss and re-resolve.
   *
   * @example
   * ```ts
   * cacheQuery({
   *   validate: (entry) => entry.value !== null && entry.value !== undefined,
   * })
   * ```
   */
  validate?: (entry: CacheEntry<T>) => boolean
  /**
   * Transform a cache entry before returning.
   * Runs on both cache hits and fresh resolves.
   *
   * @example
   * ```ts
   * cacheQuery({
   *   transform: (entry) => ({ ...entry.value, cachedAt: entry.mtime }),
   * })
   * ```
   */
  transform?: (entry: CacheEntry<T>) => T
  /**
   * Storage base prefix for cache keys.
   * Defaults to `'/cache'`.
   *
   * @example
   * ```ts
   * cacheQuery({
   *   base: '/my-app-cache',
   * })
   * ```
   */
  base?: string
  /**
   * Custom integrity value. Auto-generated from the resolver + options by default.
   * When integrity changes (e.g. after redeploy), stale cache is invalidated.
   */
  integrity?: string
  /** Error handler for cache read/write/SWR failures */
  onError?: (error: unknown) => void
}

/**
 * Wrap middleware that caches query results.
 *
 * Uses ocache under the hood: TTL, SWR, dedup, integrity, bypass, invalidation.
 * Default: 60s TTL, SWR enabled.
 *
 * @example
 * ```ts
 * const listUsers = k
 *   .$use(cacheQuery({ maxAge: 60 }))
 *   .$resolve(({ ctx }) => ctx.db.users.findMany())
 *
 * // Advanced: bypass cache for admin, custom validation
 * const listPosts = k
 *   .$use(cacheQuery({
 *     maxAge: 300,
 *     swr: true,
 *     staleMaxAge: 600,
 *     shouldBypassCache: (input) => (input as any)?.noCache,
 *     shouldInvalidateCache: (input) => (input as any)?.refresh,
 *     validate: (entry) => Array.isArray(entry.value),
 *     onError: (err) => console.error('[cache]', err),
 *   }))
 *   .$resolve(({ ctx }) => ctx.db.posts.findMany())
 * ```
 */
export function cacheQuery<T = unknown>(options: CacheQueryOptions<T> = {}): WrapDef {
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
        const resolvedName = cacheName!
        const keySet = new Set<string>()
        cacheKeyRegistry.set(resolvedName, keySet)

        const keyFn = customGetKey
          ? (input: unknown) => customGetKey(input)
          : (input: unknown) => (input !== undefined && input !== null ? hash(input) : '')

        cachedFn = defineCachedFunction(async (_input: unknown) => currentNext!(), {
          name: resolvedName,
          group: 'silgi',
          maxAge,
          swr,
          staleMaxAge,
          base: options.base,
          integrity: options.integrity,
          onError: options.onError,
          validate: options.validate as ((entry: CacheEntry) => boolean) | undefined,
          transform: options.transform as ((entry: CacheEntry) => unknown) | undefined,
          shouldBypassCache: options.shouldBypassCache
            ? (input: unknown) => options.shouldBypassCache!(input)
            : undefined,
          shouldInvalidateCache: options.shouldInvalidateCache
            ? (input: unknown) => options.shouldInvalidateCache!(input)
            : undefined,
          getKey: (input: unknown) => {
            const key = keyFn(input)
            keySet.add(`/cache:silgi:${resolvedName}:${key}.json`)
            return key
          },
        })
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
 * const createUser = k.$resolve(async ({ input, ctx }) => {
 *   const user = await ctx.db.users.create(input)
 *   await invalidateQueryCache('users_list')
 *   return user
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
 * import { setCacheStorage, createUnstorageAdapter } from 'silgi/cache'
 * import { createStorage } from 'silgi/unstorage'
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
 * import { createStorage } from 'silgi/unstorage'
 * import redisDriver from 'unstorage/drivers/redis'
 *
 * const storage = createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 * const adapter = createUnstorageAdapter(storage)
 * setCacheStorage(adapter)
 * ```
 */
export function createUnstorageAdapter(storage: UnstorageCompatible): StorageInterface {
  return {
    get: <T>(key: string) => storage.getItem<T>(key),
    set: <T>(key: string, value: T, opts?: { ttl?: number }) => {
      if (value === null || value === undefined) {
        storage.removeItem(key)
        return
      }
      storage.setItem(key, value, opts)
    },
  }
}

// ── Re-exports ──────────────────────────────────────

export type { StorageInterface, CacheOptions, CacheEntry }
