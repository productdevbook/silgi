/**
 * Storage — Nitro-style global storage with unstorage.
 *
 * Two default mounts are created automatically:
 * - `data`  — persistent data (analytics, sessions, etc.)
 * - `cache` — ephemeral cache (query results, SWR, etc.)
 *
 * Both use in-memory drivers by default. Override with custom drivers:
 *
 * ```ts
 * import redisDriver from 'unstorage/drivers/redis'
 * import fsDriver from 'unstorage/drivers/fs'
 *
 * const s = silgi({
 *   context: () => ({}),
 *   storage: {
 *     data: fsDriver({ base: '.data' }),
 *     cache: redisDriver({ url: 'redis://localhost' }),
 *   },
 * })
 *
 * // In procedures:
 * const data = useStorage('data')
 * const cache = useStorage('cache')
 * ```
 */

import { createStorage, prefixStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'

import type { Driver, Storage, StorageValue } from 'unstorage'

/** Storage config — map of mount path → driver instance, or a pre-built Storage */
export type StorageConfig = Storage | Record<string, Driver>

function _initStorage(config?: StorageConfig): Storage {
  if (config && 'getItem' in config) {
    return config as Storage
  }

  const storage = createStorage({})
  const configKeys = config ? new Set(Object.keys(config)) : null

  // Default mounts — in-memory, skipped if config provides a driver for the same path
  if (!configKeys?.has('data')) storage.mount('data', memoryDriver())
  if (!configKeys?.has('cache')) storage.mount('cache', memoryDriver())

  if (config) {
    for (const [path, driver] of Object.entries(config as Record<string, Driver>)) {
      storage.mount(path, driver)
    }
  }

  return storage
}

/**
 * Get the storage instance with optional prefix.
 * Creates default storage with `data` and `cache` mounts on first call.
 */
export function useStorage<T extends StorageValue = StorageValue>(base = ''): Storage<T> {
  const storage = ((useStorage as any)._storage ??= _initStorage())
  return (base ? prefixStorage(storage, base) : storage) as unknown as Storage<T>
}

/**
 * Initialize storage from config — call once at startup.
 */
export function initStorage(config?: StorageConfig): Storage {
  const storage = _initStorage(config)
  ;(useStorage as any)._storage = storage
  return storage
}

/**
 * Reset storage — for testing.
 */
export function resetStorage(): void {
  ;(useStorage as any)._storage = undefined
}

export type { Driver, Storage, StorageValue }
