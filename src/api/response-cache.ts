/**
 * Response Cache — memoize procedure results for identical inputs.
 *
 * For procedures marked as cacheable (queries), the serialized response
 * is cached by input hash. Subsequent identical requests skip the
 * entire pipeline + stringify — they return the cached string directly.
 *
 * This is the single biggest real-world optimization because:
 * - Most reads are repeated (same user listing, same config, etc.)
 * - Pipeline cost (50-400ns) + stringify cost (50-150ns) = 0ns on cache hit
 * - Even Node HTTP overhead (~70µs) can't be avoided, but everything else can
 */

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
    // Evict oldest if at capacity
    if (this.#map.size >= this.#maxSize) {
      const firstKey = this.#map.keys().next().value;
      if (firstKey !== undefined) this.#map.delete(firstKey);
    }
    this.#map.set(key, {
      value,
      expiresAt: Date.now() + this.#ttlMs,
    });
  }

  /** Generate a cache key from pathname + input */
  static key(pathname: string, input: unknown): string {
    if (input === undefined || input === null) return pathname;
    // Fast hash: pathname + JSON.stringify(input)
    // For small inputs (<100 chars) this is faster than a hash function
    return pathname + "\0" + JSON.stringify(input);
  }
}
