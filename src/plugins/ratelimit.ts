/**
 * Rate limiting plugin — v2 guard middleware.
 *
 * Sliding window in-memory rate limiter.
 * Pluggable: swap MemoryRateLimiter for Redis/Upstash/etc.
 */

import { KatmanError } from '../core/error.ts'

import type { GuardDef } from '../types.ts'

// ── Rate Limiter Interface ──────────────────────────

export interface RateLimitResult {
  success: boolean
  limit: number
  remaining: number
  reset: number // Unix timestamp in ms
}

export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>
}

// ── In-Memory Rate Limiter (Sliding Window) ─────────

export interface MemoryRateLimiterOptions {
  /** Maximum requests per window */
  limit: number
  /** Window duration in milliseconds */
  windowMs: number
}

export class MemoryRateLimiter implements RateLimiter {
  #limit: number
  #windowMs: number
  #store = new Map<string, number[]>()

  constructor(options: MemoryRateLimiterOptions) {
    this.#limit = options.limit
    this.#windowMs = options.windowMs
  }

  async limit(key: string): Promise<RateLimitResult> {
    const now = Date.now()
    const windowStart = now - this.#windowMs

    let timestamps = this.#store.get(key)
    if (!timestamps) {
      timestamps = []
      this.#store.set(key, timestamps)
    }

    // Remove expired
    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift()
    }

    const remaining = Math.max(0, this.#limit - timestamps.length)
    const reset = timestamps.length > 0 ? timestamps[0]! + this.#windowMs : now + this.#windowMs

    if (timestamps.length >= this.#limit) {
      return { success: false, limit: this.#limit, remaining: 0, reset }
    }

    timestamps.push(now)
    return { success: true, limit: this.#limit, remaining: remaining - 1, reset }
  }
}

// ── Rate Limit Guard ────────────────────────────────

export interface RateLimitGuardOptions {
  /** The rate limiter instance */
  limiter: RateLimiter
  /** Extract rate limit key from context */
  keyFn: (ctx: Record<string, unknown>) => string | Promise<string>
  /** Custom error message */
  message?: string
}

/**
 * Create a rate limiting guard.
 *
 * @example
 * ```ts
 * import { rateLimitGuard, MemoryRateLimiter } from "katman/ratelimit"
 *
 * const rateLimit = rateLimitGuard({
 *   limiter: new MemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
 *   keyFn: (ctx) => (ctx as any).ip ?? "anonymous",
 * })
 *
 * const proc = k.query({
 *   use: [rateLimit],
 *   resolve: () => ({ ok: true }),
 * })
 * ```
 */
export function rateLimitGuard(options: RateLimitGuardOptions): GuardDef<any, any> {
  return {
    kind: 'guard',
    fn: async (ctx: any) => {
      const key = await options.keyFn(ctx)
      const result = await options.limiter.limit(key)

      if (!result.success) {
        throw new KatmanError('TOO_MANY_REQUESTS', {
          status: 429,
          message: options.message ?? 'Rate limit exceeded',
          data: {
            limit: result.limit,
            remaining: result.remaining,
            reset: result.reset,
            retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
          },
        })
      }

      return { rateLimit: result }
    },
  }
}
