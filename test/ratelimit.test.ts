import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MemoryRateLimiter,
  createRateLimitMiddleware,
} from "../src/plugins/ratelimit/index.ts";
import { KatmanError } from "../src/core/error.ts";

describe("MemoryRateLimiter", () => {
  it("allows requests within limit", async () => {
    const limiter = new MemoryRateLimiter({ limit: 3, windowMs: 1000 });

    const r1 = await limiter.limit("user-1");
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.limit("user-1");
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.limit("user-1");
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);
  });

  it("rejects requests over limit", async () => {
    const limiter = new MemoryRateLimiter({ limit: 2, windowMs: 1000 });

    await limiter.limit("user-1");
    await limiter.limit("user-1");
    const r3 = await limiter.limit("user-1");

    expect(r3.success).toBe(false);
    expect(r3.remaining).toBe(0);
  });

  it("tracks limits per key independently", async () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 1000 });

    const r1 = await limiter.limit("user-1");
    const r2 = await limiter.limit("user-2");

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
  });

  it("resets after window expires", async () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 50 });

    const r1 = await limiter.limit("user-1");
    expect(r1.success).toBe(true);

    const r2 = await limiter.limit("user-1");
    expect(r2.success).toBe(false);

    // Wait for window to expire
    await new Promise((r) => setTimeout(r, 60));

    const r3 = await limiter.limit("user-1");
    expect(r3.success).toBe(true);
  });

  it("returns correct limit and reset values", async () => {
    const limiter = new MemoryRateLimiter({ limit: 5, windowMs: 60000 });
    const result = await limiter.limit("user-1");

    expect(result.limit).toBe(5);
    expect(result.remaining).toBe(4);
    expect(result.reset).toBeGreaterThan(Date.now());
  });
});

describe("Rate Limit Middleware", () => {
  it("allows requests within limit", async () => {
    const limiter = new MemoryRateLimiter({ limit: 10, windowMs: 1000 });
    const middleware = createRateLimitMiddleware({
      limiter,
      keyFn: (ctx: any) => ctx.ip ?? "anon",
    });

    let nextCalled = false;
    await middleware(
      {
        context: { ip: "1.2.3.4" } as any,
        path: ["test"],
        signal: AbortSignal.timeout(5000),
        meta: {},
        errors: {},
        next: async () => { nextCalled = true; return { output: "ok", context: {} }; },
      },
      null,
    );

    expect(nextCalled).toBe(true);
  });

  it("throws TOO_MANY_REQUESTS when limit exceeded", async () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 1000 });
    const middleware = createRateLimitMiddleware({
      limiter,
      keyFn: () => "test-key",
    });

    const opts = {
      context: {} as any,
      path: ["test"],
      signal: AbortSignal.timeout(5000),
      meta: {},
      errors: {},
      next: async () => ({ output: "ok", context: {} }),
    };

    // First call succeeds
    await middleware(opts, null);

    // Second call should throw
    await expect(middleware(opts, null)).rejects.toThrow(KatmanError);
    await expect(middleware(opts, null)).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
    });
  });
});
