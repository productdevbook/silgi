/**
 * Response Cache — memoize procedure results for identical inputs.
 *
 * For procedures marked as cacheable (queries), the serialized response
 * is cached by input hash. Subsequent identical requests skip the
 * entire pipeline + stringify — they return the cached string directly.
 *
 * Uses ohash for deterministic key generation on complex inputs.
 */

import { hash } from "ohash";

export interface CacheOptions {
  /** Max entries (default: 1000) */
  maxSize?: number;
  /** TTL in ms (default: 5000) */
  ttlMs?: number;
}

interface CacheEntry {
  value: string; // pre-serialized response
  expiresAt: number;
}

export class ResponseCache {
  #map = new Map<string, CacheEntry>();
  #maxSize: number;
  #ttlMs: number;

  constructor(options: CacheOptions = {}) {
    this.#maxSize = options.maxSize ?? 1000;
    this.#ttlMs = options.ttlMs ?? 5000;
  }

  /** Number of cached entries */
  get size(): number { return this.#map.size; }

  get(key: string): string | undefined {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.#map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: string): void {
    if (this.#map.size >= this.#maxSize) {
      const firstKey = this.#map.keys().next().value;
      if (firstKey !== undefined) this.#map.delete(firstKey);
    }
    this.#map.set(key, {
      value,
      expiresAt: Date.now() + this.#ttlMs,
    });
  }

  /** Invalidate a specific key */
  delete(key: string): boolean {
    return this.#map.delete(key);
  }

  /** Clear all entries */
  clear(): void {
    this.#map.clear();
  }

  /** Invalidate all entries matching a path prefix */
  invalidateByPrefix(prefix: string): number {
    let count = 0;
    for (const key of this.#map.keys()) {
      if (key.startsWith(prefix)) {
        this.#map.delete(key);
        count++;
      }
    }
    return count;
  }

  /**
   * Generate a deterministic cache key from pathname + input.
   * Uses ohash for complex objects (Date, Map, Set, nested).
   * Fast path for simple/no inputs.
   */
  static key(pathname: string, input: unknown): string {
    if (input === undefined || input === null) return pathname;
    return pathname + ":" + hash(input);
  }
}
