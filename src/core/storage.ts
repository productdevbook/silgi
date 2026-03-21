/**
 * Storage integration — unstorage with type-safe driver config.
 *
 * Two usage modes:
 *
 * 1. Declarative config (type-safe driver options):
 * ```ts
 * import redisDriver from 'unstorage/drivers/redis'
 * import memoryDriver from 'unstorage/drivers/memory'
 *
 * const s = silgi({
 *   context: () => ({}),
 *   storage: {
 *     cache: redisDriver({ url: 'redis://localhost' }),
 *     sessions: memoryDriver(),
 *   },
 * })
 * ```
 *
 * 2. Bring your own storage instance:
 * ```ts
 * const storage = createStorage({})
 * storage.mount('cache', redisDriver({ ... }))
 *
 * const s = silgi({
 *   context: () => ({}),
 *   storage,
 * })
 * ```
 */

import { createStorage, prefixStorage } from 'unstorage'

import type { Driver, Storage, StorageValue } from 'unstorage'

// ── Storage config type ─────────────────────────────

/** Storage config — map of mount path → driver instance, or a pre-built Storage */
export type StorageConfig = Storage | Record<string, Driver>

// ── Storage initialization ──────────────────────────

let _storage: Storage | undefined

/**
 * Initialize storage from config — called once at startup.
 * Accepts either a pre-built Storage or a map of mount paths → drivers.
 */
export function initStorage(config?: StorageConfig): Storage {
  if (_storage) return _storage

  if (config && 'getItem' in config) {
    // Pre-built Storage instance
    _storage = config as Storage
    return _storage
  }

  _storage = createStorage({})

  if (config) {
    for (const [path, driver] of Object.entries(config as Record<string, Driver>)) {
      _storage.mount(path, driver)
    }
  }

  return _storage
}

/**
 * Get the storage instance with optional prefix.
 * Creates default in-memory if not initialized.
 */
export function useStorage<T extends StorageValue = StorageValue>(base = ''): Storage<T> {
  const storage = _storage ?? initStorage()
  return (base ? prefixStorage(storage, base) : storage) as unknown as Storage<T>
}

/**
 * Reset storage — for testing.
 */
export function resetStorage(): void {
  _storage = undefined
}

export type { Driver, Storage, StorageValue }
