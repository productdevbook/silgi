/**
 * Response cache plugin
 * -----------------------
 *
 * Caches resolver output using `ocache` underneath. Drop the wrap on
 * a query procedure and its return value is memoized, deduplicated,
 * and (by default) served stale-while-revalidate.
 *
 * The storage backend is pluggable. If the parent silgi instance has
 * a `'cache'` mount configured via `silgi({ storage })`, we wire ocache
 * to that mount the first time `cacheQuery()` runs. Otherwise ocache
 * falls back to its built-in in-memory map. Users who want a different
 * backend without the silgi storage mount can call `setCacheStorage()`
 * directly, or wrap an unstorage instance via `createUnstorageAdapter()`.
 *
 * Every ocache feature is exposed through the options:
 *
 *   TTL + stale-while-revalidate    — `maxAge`, `swr`, `staleMaxAge`
 *   Request deduplication           — built-in, concurrent calls share
 *                                     one in-flight promise
 *   Integrity                       — redeploy invalidates stale cache
 *                                     when the resolver's hash changes
 *   Per-request bypass / invalidate — `shouldBypassCache`,
 *                                     `shouldInvalidateCache`
 *   Entry validation / transform    — `validate`, `transform`
 *   Multi-tier storage              — read cascade, write to all
 *   Manual invalidation             — `invalidateQueryCache(name)`
 *
 * @example
 *   import { cacheQuery, setCacheStorage, createUnstorageAdapter } from 'silgi/cache'
 *   import { createStorage } from 'silgi/unstorage'
 *   import redisDriver from 'unstorage/drivers/redis'
 *
 *   const listUsers = k
 *     .$use(cacheQuery({ maxAge: 60 }))
 *     .$resolve(({ ctx }) => ctx.db.users.findMany())
 *
 *   const storage = createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 *   setCacheStorage(createUnstorageAdapter(storage))
 */

import { defineCachedFunction, setStorage, useStorage as useOcacheStorage } from 'ocache'
import { hash } from 'ohash'

import { RAW_INPUT } from '../compile.ts'
import { useStorage } from '../core/storage.ts'

import type { WrapDef } from '../types.ts'
import type { CacheEntry, CacheOptions, StorageInterface } from 'ocache'

// ─── Storage wiring ───────────────────────────────────────────────────

/**
 * Minimal interface matching an unstorage `Storage`. We describe it
 * locally so the cache plugin does not take a hard dependency on the
 * unstorage package — users bring their own.
 */
export interface UnstorageCompatible {
  getItem<T = unknown>(key: string): Promise<T | null> | T | null
  setItem(key: string, value: unknown, opts?: { ttl?: number }): Promise<void> | void
  removeItem(key: string): Promise<void> | void
}

/**
 * Build an ocache `StorageInterface` from anything that quacks like
 * an unstorage store. The plugin uses it twice — once internally to
 * bridge silgi's configured storage mount, and once as a public helper
 * for users who bring their own unstorage instance.
 *
 * Setting `value` to `null` / `undefined` intentionally triggers a
 * delete so ocache's "mark as stale" signalling survives every
 * backend uniformly.
 */
function adaptUnstorage(storage: UnstorageCompatible): StorageInterface {
  return {
    get: <T>(key: string) => storage.getItem<T>(key),
    set: <T>(key: string, value: T, opts?: { ttl?: number }) => {
      // Returning the underlying Promise (not `void`) is important: a
      // silent storage failure (Redis SET timeout, quota exceeded)
      // would otherwise look like a successful cache write and the
      // entry would vanish on the next read.
      if (value === null || value === undefined) {
        return storage.removeItem(key) as unknown as Promise<void>
      }
      return storage.setItem(key, value, opts) as unknown as Promise<void>
    },
  }
}

/**
 * Public helper for users who already have an unstorage instance.
 *
 * @example
 *   const storage = createStorage({ driver: redisDriver({ ... }) })
 *   setCacheStorage(createUnstorageAdapter(storage))
 */
export function createUnstorageAdapter(storage: UnstorageCompatible): StorageInterface {
  return adaptUnstorage(storage)
}

/**
 * Connect ocache to the silgi instance's `'cache'` storage mount, if
 * one is configured. Idempotent — the first `cacheQuery()` call wins
 * and every subsequent one is a cheap boolean check.
 *
 * When silgi has no storage mount the call is a silent no-op: ocache
 * keeps its built-in in-memory backend, which is still correct (just
 * not shared across processes).
 */
let storageConnected = false
function ensureStorageConnected(): void {
  if (storageConnected) return
  storageConnected = true
  try {
    setStorage(adaptUnstorage(useStorage('cache')))
  } catch {
    // No silgi storage mount configured — ocache keeps its in-memory fallback.
  }
}

// ─── Invalidation registry ────────────────────────────────────────────

/**
 * Per-procedure set of cache keys, keyed by the procedure's cache name.
 * `invalidateQueryCache(name)` uses this to wipe every key that a given
 * procedure has written to backing storage.
 *
 * Module-global by design: different silgi instances in the same
 * process calling the same procedure name end up sharing the same
 * ocache backend anyway, so a unified registry is correct.
 */
const cacheKeyRegistry = new Map<string, Set<string>>()

// ─── Options ──────────────────────────────────────────────────────────

export interface CacheQueryOptions<T = unknown> {
  /** Cache TTL in seconds. @default 60 */
  maxAge?: number
  /** Enable stale-while-revalidate. @default true */
  swr?: boolean
  /** Max seconds to serve stale while revalidating. @default maxAge */
  staleMaxAge?: number
  /** Custom cache-key generator from the request input. */
  getKey?: (input: unknown) => string
  /** Human-readable cache name. Defaults to the procedure path. */
  name?: string
  /**
   * Return `true` to skip cache entirely and call the resolver
   * directly. Useful for admin users or debug modes.
   */
  shouldBypassCache?: (input: unknown) => boolean | Promise<boolean>
  /**
   * Return `true` to invalidate cache for this key and re-resolve.
   * The new result is cached normally.
   */
  shouldInvalidateCache?: (input: unknown) => boolean | Promise<boolean>
  /** Validate a cache entry before returning it. `false` = treat as miss. */
  validate?: (entry: CacheEntry<T>) => boolean
  /** Transform a cache entry before returning. Runs on both hits and fresh resolves. */
  transform?: (entry: CacheEntry<T>) => T
  /** Storage key prefix. @default '/cache' */
  base?: string
  /**
   * Custom integrity value. Auto-generated from the resolver + options
   * by default; when it changes (e.g. after a redeploy) stale cache is
   * invalidated.
   */
  integrity?: string
  /** Error handler for cache read / write / SWR failures. */
  onError?: (error: unknown) => void
}

// ─── Cache wrap ───────────────────────────────────────────────────────

/**
 * Build the cache-key generator from user options. When the user
 * passes `getKey`, we use it verbatim. Otherwise we hash the input
 * with ohash, falling back to an empty string when there is no input
 * (shared-cache-for-parameterless-queries is almost always what
 * people want).
 */
function buildKeyFn(custom?: (input: unknown) => string): (input: unknown) => string {
  if (custom) return custom
  return (input) => (input !== undefined && input !== null ? hash(input) : '')
}

/**
 * Wrap middleware that caches a query procedure's output.
 *
 * Defaults: 60-second TTL, SWR on. Every other knob comes from
 * {@link CacheQueryOptions}.
 *
 * @example
 *   const listPosts = k
 *     .$use(cacheQuery({
 *       maxAge: 300,
 *       staleMaxAge: 600,
 *       shouldBypassCache: (input) => (input as any)?.noCache,
 *       validate: (entry) => Array.isArray(entry.value),
 *       onError: (err) => console.error('[cache]', err),
 *     }))
 *     .$resolve(({ ctx }) => ctx.db.posts.findMany())
 */
export function cacheQuery<T = unknown>(options: CacheQueryOptions<T> = {}): WrapDef {
  const maxAge = options.maxAge ?? 60
  const swr = options.swr ?? true
  const staleMaxAge = options.staleMaxAge ?? maxAge
  const customGetKey = options.getKey

  let cacheName = options.name
  let cachedFn: ReturnType<typeof defineCachedFunction> | null = null
  let keyFn: (input: unknown) => string = buildKeyFn(customGetKey)

  /**
   * Two concurrent requests can race through the same cache entry:
   * ocache calls our inner `_resolve` for each one, and they must not
   * share a closure-scoped `next`. We keep a per-request map keyed
   * by a monotonic counter so each call resolves its *own* `next()`.
   */
  const pendingNext = new Map<string, () => Promise<unknown>>()
  let requestCounter = 0

  return {
    kind: 'wrap',
    fn: async (ctx, next) => {
      ensureStorageConnected()

      // Lazy init. We wait until the first call so that we can pick up
      // the procedure path off `ctx` (set by the pipeline) rather than
      // asking the user to pass a `name` manually.
      if (!cachedFn) {
        cacheName ??= (ctx as { __procedurePath?: string }).__procedurePath ?? `proc_${hash(next.toString()).slice(0, 8)}`
        const resolvedName = cacheName
        const resolvedBase = options.base ?? '/cache'
        const keySet = new Set<string>()
        cacheKeyRegistry.set(resolvedName, keySet)

        cachedFn = defineCachedFunction(
          async (_input: unknown, requestId?: string) => {
            const key = requestId ?? keyFn(_input)
            const fn = pendingNext.get(key)
            if (!fn) {
              // Safety net — ocache should always call us with a
              // requestId we stashed a moment earlier. If it does not,
              // we throw rather than silently returning stale data.
              throw new Error('[silgi/cache] Missing next() for cache resolve')
            }
            pendingNext.delete(key)
            return fn()
          },
          {
            name: resolvedName,
            group: 'silgi',
            maxAge,
            swr,
            staleMaxAge,
            base: resolvedBase,
            integrity: options.integrity,
            onError: options.onError,
            validate: options.validate as ((entry: CacheEntry) => boolean) | undefined,
            transform: options.transform as ((entry: CacheEntry) => unknown) | undefined,
            shouldBypassCache: options.shouldBypassCache,
            shouldInvalidateCache: options.shouldInvalidateCache,
            getKey: (input: unknown) => {
              const key = keyFn(input)
              // Record the fully-qualified storage key so manual
              // invalidation can wipe it later.
              keySet.add(`${resolvedBase}:silgi:${resolvedName}:${key}.json`)
              return key
            },
          },
        )
      }

      const input = (ctx as Record<PropertyKey, unknown>)[RAW_INPUT]
      const requestId = `__req_${++requestCounter}`
      pendingNext.set(requestId, next)
      return cachedFn(input, requestId)
    },
  }
}

// ─── Invalidation ─────────────────────────────────────────────────────

/**
 * Wipe every cached entry for a procedure by its cache name.
 *
 * Typically called after a mutation that makes related queries stale.
 * Names default to the procedure's auto-generated path, or whatever
 * was passed via `cacheQuery({ name })`.
 *
 * @example
 *   const createUser = k.$resolve(async ({ input, ctx }) => {
 *     const user = await ctx.db.users.create(input)
 *     await invalidateQueryCache('users_list')
 *     return user
 *   })
 */
export async function invalidateQueryCache(name: string): Promise<void> {
  const keys = cacheKeyRegistry.get(name)
  if (!keys) return

  const storage = useOcacheStorage()
  await Promise.all([...keys].map((key) => storage.set(key, null)))
  keys.clear()
}

// ─── Storage override ─────────────────────────────────────────────────

/**
 * Replace ocache's storage backend. Default is an in-memory map with
 * TTL; production deployments usually want Redis or Cloudflare KV via
 * `createUnstorageAdapter()`.
 *
 * @example
 *   setCacheStorage(createUnstorageAdapter(
 *     createStorage({ driver: redisDriver({ url: 'redis://localhost' }) })
 *   ))
 */
export function setCacheStorage(storage: StorageInterface): void {
  setStorage(storage)
}

// ─── Re-exports ───────────────────────────────────────────────────────

export type { StorageInterface, CacheOptions, CacheEntry }
