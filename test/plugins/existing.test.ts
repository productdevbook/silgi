/**
 * v2 plugins — CORS, OTel, Pino, Rate Limiting.
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { corsHeaders } from "#src/plugins/cors.ts";
import { otelWrap, type Tracer, type Span } from "#src/plugins/otel.ts";
import { loggingHooks, type Logger } from "#src/plugins/pino.ts";
import { rateLimitGuard, MemoryRateLimiter } from "#src/plugins/ratelimit.ts";
import { compileProcedure } from "#src/compile.ts";

// ── CORS ────────────────────────────────────────────

describe("CORS", () => {
  it("generates default CORS headers", () => {
    const h = corsHeaders();
    expect(h["access-control-allow-origin"]).toBe("*");
    expect(h["access-control-allow-methods"]).toContain("GET");
    expect(h["access-control-allow-methods"]).toContain("POST");
    expect(h["access-control-allow-headers"]).toContain("Content-Type");
  });

  it("generates CORS headers with custom origin", () => {
    const h = corsHeaders({ origin: "https://example.com" });
    expect(h["access-control-allow-origin"]).toBe("https://example.com");
  });

  it("generates CORS headers with credentials", () => {
    const h = corsHeaders({ credentials: true });
    expect(h["access-control-allow-credentials"]).toBe("true");
  });

  it("handles array origins", () => {
    const h = corsHeaders({ origin: ["https://a.com", "https://b.com"] }, "https://b.com");
    expect(h["access-control-allow-origin"]).toBe("https://b.com");
    expect(h["vary"]).toBe("Origin");
  });

  it("handles function origin", () => {
    const h = corsHeaders({ origin: (o) => o.endsWith(".example.com") }, "app.example.com");
    expect(h["access-control-allow-origin"]).toBe("app.example.com");
  });

  it("sets maxAge", () => {
    const h = corsHeaders({ maxAge: 86400 });
    expect(h["access-control-max-age"]).toBe("86400");
  });
});

// ── OTel ────────────────────────────────────────────

describe("OTel wrap", () => {
  function mockTracer(): Tracer & { spans: any[] } {
    const spans: any[] = [];
    return {
      spans,
      startSpan(name, options) {
        const span = {
          name,
          attributes: { ...options?.attributes },
          status: null as any,
          events: [] as any[],
          ended: false,
          setAttribute(k: string, v: any) { span.attributes[k] = v; },
          setStatus(s: any) { span.status = s; },
          addEvent(n: string, a?: any) { span.events.push({ name: n, attributes: a }); },
          end() { span.ended = true; },
        };
        spans.push(span);
        return span;
      },
    };
  }

  it("wraps a procedure call in a span", async () => {
    const tracer = mockTracer();
    const tracing = otelWrap(tracer);

    const proc = compileProcedure({
      type: "query", input: null, output: null, errors: null,
      use: [tracing],
      resolve: () => ({ ok: true }),
      route: null,
    });

    await proc({}, undefined, AbortSignal.timeout(5000));

    expect(tracer.spans).toHaveLength(1);
    expect(tracer.spans[0].status.code).toBe(0);
    expect(tracer.spans[0].ended).toBe(true);
  });

  it("records error spans", async () => {
    const tracer = mockTracer();
    const tracing = otelWrap(tracer);

    const proc = compileProcedure({
      type: "query", input: null, output: null, errors: null,
      use: [tracing],
      resolve: () => { throw new Error("fail"); },
      route: null,
    });

    await expect(proc({}, undefined, AbortSignal.timeout(5000))).rejects.toThrow("fail");
    expect(tracer.spans[0].status.code).toBe(2);
    expect(tracer.spans[0].events[0].name).toBe("exception");
  });
});

// ── Pino ────────────────────────────────────────────

describe("Pino logging hooks", () => {
  function mockLogger(): Logger & { logs: any[] } {
    const logs: any[] = [];
    const logger: any = {
      logs,
      info(obj: any, msg?: string) { logs.push({ level: "info", ...obj, msg }); },
      error(obj: any, msg?: string) { logs.push({ level: "error", ...obj, msg }); },
      warn(obj: any, msg?: string) { logs.push({ level: "warn", ...obj, msg }); },
      debug(obj: any, msg?: string) { logs.push({ level: "debug", ...obj, msg }); },
      child() { return logger; },
    };
    return logger;
  }

  it("logs requests and responses", async () => {
    const logger = mockLogger();
    const hooks = loggingHooks({ logger });
    const k = katman({ context: () => ({}), hooks: hooks as any });
    const router = k.router({ health: k.query(() => ({ ok: true })) });
    const handle = k.handler(router);

    await handle(new Request("http://localhost/health", { method: "POST" }));

    expect(logger.logs.some((l) => l.msg === "request received")).toBe(true);
    expect(logger.logs.some((l) => l.msg === "response sent")).toBe(true);
  });

  it("logs errors", async () => {
    const logger = mockLogger();
    const hooks = loggingHooks({ logger });
    const k = katman({ context: () => ({}), hooks: hooks as any });
    const router = k.router({ fail: k.query(() => { throw new Error("boom"); }) });
    const handle = k.handler(router);

    await handle(new Request("http://localhost/fail", { method: "POST" }));

    expect(logger.logs.some((l) => l.msg === "request error")).toBe(true);
  });
});

// ── Rate Limiting ───────────────────────────────────

describe("Rate limiting", () => {
  it("MemoryRateLimiter allows requests within limit", async () => {
    const limiter = new MemoryRateLimiter({ limit: 3, windowMs: 1000 });

    const r1 = await limiter.limit("user1");
    expect(r1.success).toBe(true);
    expect(r1.remaining).toBe(2);

    const r2 = await limiter.limit("user1");
    expect(r2.success).toBe(true);
    expect(r2.remaining).toBe(1);

    const r3 = await limiter.limit("user1");
    expect(r3.success).toBe(true);
    expect(r3.remaining).toBe(0);

    const r4 = await limiter.limit("user1");
    expect(r4.success).toBe(false);
  });

  it("different keys have independent limits", async () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 1000 });

    expect((await limiter.limit("a")).success).toBe(true);
    expect((await limiter.limit("a")).success).toBe(false);
    expect((await limiter.limit("b")).success).toBe(true);
  });

  it("rateLimitGuard throws TOO_MANY_REQUESTS", async () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 1000 });
    const guard = rateLimitGuard({
      limiter,
      keyFn: () => "test",
    });

    const proc = compileProcedure({
      type: "query", input: null, output: null, errors: null,
      use: [guard],
      resolve: () => ({ ok: true }),
      route: null,
    });

    // First call succeeds
    const r1 = await proc({}, undefined, AbortSignal.timeout(5000));
    expect(r1).toEqual({ ok: true });

    // Second call fails
    await expect(proc({}, undefined, AbortSignal.timeout(5000))).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      status: 429,
    });
  });

  it("window expires and allows new requests", async () => {
    const limiter = new MemoryRateLimiter({ limit: 1, windowMs: 50 });

    expect((await limiter.limit("x")).success).toBe(true);
    expect((await limiter.limit("x")).success).toBe(false);

    await new Promise((r) => setTimeout(r, 60));
    expect((await limiter.limit("x")).success).toBe(true);
  });
});
