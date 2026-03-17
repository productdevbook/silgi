/**
 * Rate Limiting — pluggable middleware with in-memory adapter.
 *
 * Supports sliding window algorithm with configurable limits.
 * Can be extended with Redis, Upstash, etc.
 */

import type { Context, Promisable } from "../../core/types.ts";
import type { Middleware, MiddlewareResult, MiddlewareOptions } from "../../core/pipeline.ts";
import { KatmanError } from "../../core/error.ts";

// === Rate Limiter Interface ===

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // Unix timestamp in ms
}

export interface RateLimiter {
  limit(key: string): Promise<RateLimitResult>;
}

// === In-Memory Rate Limiter (Sliding Window) ===

export interface MemoryRateLimiterOptions {
  /** Maximum requests per window */
  limit: number;
  /** Window duration in milliseconds */
  windowMs: number;
}

export class MemoryRateLimiter implements RateLimiter {
  #limit: number;
  #windowMs: number;
  #store = new Map<string, number[]>();

  constructor(options: MemoryRateLimiterOptions) {
    this.#limit = options.limit;
    this.#windowMs = options.windowMs;
  }

  async limit(key: string): Promise<RateLimitResult> {
    const now = Date.now();
    const windowStart = now - this.#windowMs;

    // Get or create timestamps array
    let timestamps = this.#store.get(key);
    if (!timestamps) {
      timestamps = [];
      this.#store.set(key, timestamps);
    }

    // Remove expired timestamps
    while (timestamps.length > 0 && timestamps[0]! < windowStart) {
      timestamps.shift();
    }

    const remaining = Math.max(0, this.#limit - timestamps.length);
    const reset = timestamps.length > 0 ? timestamps[0]! + this.#windowMs : now + this.#windowMs;

    if (timestamps.length >= this.#limit) {
      return { success: false, limit: this.#limit, remaining: 0, reset };
    }

    timestamps.push(now);
    return { success: true, limit: this.#limit, remaining: remaining - 1, reset };
  }
}

// === Rate Limit Middleware ===

export interface RateLimitMiddlewareOptions<TContext extends Context = Context> {
  /** The rate limiter instance */
  limiter: RateLimiter;
  /** Function to extract the rate limit key from context/input */
  keyFn: (context: TContext, input: unknown) => Promisable<string>;
  /** Custom error message */
  message?: string;
}

/**
 * Create a rate limiting middleware.
 *
 * Usage:
 *   const rateLimit = createRateLimitMiddleware({
 *     limiter: new MemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
 *     keyFn: (ctx) => ctx.ip ?? "anonymous",
 *   })
 *   const proc = ks.use(rateLimit).handler(...)
 */
export function createRateLimitMiddleware<TContext extends Context = Context>(
  options: RateLimitMiddlewareOptions<TContext>,
): Middleware<TContext, TContext> {
  return async (opts: MiddlewareOptions<TContext, unknown>, input: unknown) => {
    const key = await options.keyFn(opts.context, input);
    const result = await options.limiter.limit(key);

    if (!result.success) {
      throw new KatmanError("TOO_MANY_REQUESTS", {
        message: options.message ?? "Rate limit exceeded",
        data: {
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
          retryAfter: Math.ceil((result.reset - Date.now()) / 1000),
        },
      });
    }

    return opts.next();
  };
}

// === Rate Limit Response Headers (Handler Plugin) ===

import type { StandardHandlerPlugin, StandardHandlerOptions } from "../../server/adapters/standard/handler.ts";

export class RateLimitHeaderPlugin<TContext extends Context = Context>
  implements StandardHandlerPlugin<TContext>
{
  readonly order = 3_000_000;
  #limiter: RateLimiter;
  #keyFn: (context: TContext) => string;

  constructor(options: {
    limiter: RateLimiter;
    keyFn: (context: TContext) => string;
  }) {
    this.#limiter = options.limiter;
    this.#keyFn = options.keyFn;
  }

  init(options: StandardHandlerOptions<TContext>): void {
    const limiter = this.#limiter;
    const keyFn = this.#keyFn;

    options.rootInterceptors ??= [];
    options.rootInterceptors.push(async (opts: any) => {
      const result = await opts.next();
      if (!result.matched || !result.response) return result;

      try {
        const context = opts.context ?? opts.handlerOptions?.context;
        if (!context) return result;

        const key = keyFn(context);
        const limitResult = await limiter.limit(key);

        const headers = { ...result.response.headers };
        headers["ratelimit-limit"] = String(limitResult.limit);
        headers["ratelimit-remaining"] = String(limitResult.remaining);
        headers["ratelimit-reset"] = String(Math.ceil(limitResult.reset / 1000));

        if (!limitResult.success) {
          headers["retry-after"] = String(
            Math.ceil((limitResult.reset - Date.now()) / 1000),
          );
        }

        return {
          ...result,
          response: { ...result.response, headers },
        };
      } catch {
        return result;
      }
    });
  }
}
