import { describe, it, expect, vi } from "vitest";
import { withRetry } from "../src/client/plugins/retry.ts";
import { withDedupe } from "../src/client/plugins/dedupe.ts";
import type { ClientLink } from "../src/client/types.ts";
import { RouteMatcher, flattenRouter } from "../src/server/adapters/standard/matcher.ts";
import { ks } from "../src/server/builder.ts";

describe("Client Retry Plugin", () => {
  it("retries on failure", async () => {
    let attempts = 0;
    const link: ClientLink = {
      call: vi.fn(async () => {
        attempts++;
        if (attempts < 3) throw new Error("fail");
        return "success";
      }),
    };

    const retrying = withRetry(link, { maxRetries: 5, retryDelay: 0 });
    const result = await retrying.call(["test"], null, {});
    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("throws after max retries", async () => {
    const link: ClientLink = {
      call: vi.fn(async () => { throw new Error("always fail"); }),
    };

    const retrying = withRetry(link, { maxRetries: 2, retryDelay: 0 });
    await expect(retrying.call(["test"], null, {})).rejects.toThrow("always fail");
    expect(link.call).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("respects shouldRetry predicate", async () => {
    let attempts = 0;
    const link: ClientLink = {
      call: vi.fn(async () => {
        attempts++;
        throw new Error("fatal");
      }),
    };

    const retrying = withRetry(link, {
      maxRetries: 5,
      retryDelay: 0,
      shouldRetry: () => false,
    });

    await expect(retrying.call(["test"], null, {})).rejects.toThrow("fatal");
    expect(attempts).toBe(1); // No retries
  });
});

describe("Client Dedupe Plugin", () => {
  it("deduplicates identical concurrent requests", async () => {
    let callCount = 0;
    const link: ClientLink = {
      call: vi.fn(async (path, input) => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return `result-${callCount}`;
      }),
    };

    const deduped = withDedupe(link);

    // Fire two identical requests concurrently
    const [r1, r2] = await Promise.all([
      deduped.call(["users", "list"], { limit: 10 }, {}),
      deduped.call(["users", "list"], { limit: 10 }, {}),
    ]);

    expect(r1).toBe(r2); // Same response
    expect(callCount).toBe(1); // Only one actual call
  });

  it("does NOT dedupe different requests", async () => {
    let callCount = 0;
    const link: ClientLink = {
      call: vi.fn(async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
        return `result-${callCount}`;
      }),
    };

    const deduped = withDedupe(link);

    await Promise.all([
      deduped.call(["users", "list"], { limit: 10 }, {}),
      deduped.call(["users", "list"], { limit: 20 }, {}),
    ]);

    expect(callCount).toBe(2);
  });
});

describe("RouteMatcher", () => {
  it("matches static routes", () => {
    const matcher = new RouteMatcher();
    const proc = ks.handler(async () => "ok") as any;

    matcher.add("GET", "/users/list", proc);
    const result = matcher.match("/users/list");

    expect(result).toBeDefined();
    expect(result!.procedure).toBe(proc);
  });

  it("matches dynamic params", () => {
    const matcher = new RouteMatcher();
    const proc = ks.handler(async () => "ok") as any;

    matcher.add("GET", "/users/{id}", proc);
    const result = matcher.match("/users/42");

    expect(result).toBeDefined();
    expect(result!.params.id).toBe("42");
  });

  it("matches wildcard params", () => {
    const matcher = new RouteMatcher();
    const proc = ks.handler(async () => "ok") as any;

    matcher.add("GET", "/files/{+path}", proc);
    const result = matcher.match("/files/docs/readme.md");

    expect(result).toBeDefined();
    expect(result!.params.path).toBe("docs/readme.md");
  });

  it("returns undefined for unmatched routes", () => {
    const matcher = new RouteMatcher();
    const proc = ks.handler(async () => "ok") as any;

    matcher.add("GET", "/users", proc);
    expect(matcher.match("/posts")).toBeUndefined();
  });

  it("prefers static over dynamic", () => {
    const matcher = new RouteMatcher();
    const staticProc = ks.handler(async () => "static") as any;
    const dynamicProc = ks.handler(async () => "dynamic") as any;

    matcher.add("GET", "/users/me", staticProc);
    matcher.add("GET", "/users/{id}", dynamicProc);

    const result = matcher.match("/users/me");
    expect(result!.procedure).toBe(staticProc);

    const result2 = matcher.match("/users/42");
    expect(result2!.procedure).toBe(dynamicProc);
  });
});

describe("flattenRouter", () => {
  it("flattens a nested router", async () => {
    const proc1 = ks.handler(async () => "a");
    const proc2 = ks.handler(async () => "b");
    const router = { users: { list: proc1, get: proc2 } };

    const flat = await flattenRouter(router as any);
    expect(flat.size).toBe(2);
    expect(flat.has("users/list")).toBe(true);
    expect(flat.has("users/get")).toBe(true);
  });
});
