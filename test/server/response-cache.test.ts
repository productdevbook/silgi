/**
 * ResponseCache tests — ohash key generation, TTL, eviction.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResponseCache } from "#src/response-cache.ts";

describe("ResponseCache", () => {
  let cache: ResponseCache;

  beforeEach(() => {
    cache = new ResponseCache({ maxSize: 3, ttlMs: 100 });
  });

  it("stores and retrieves values", () => {
    cache.set("key1", '{"ok":true}');
    expect(cache.get("key1")).toBe('{"ok":true}');
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires entries after TTL", async () => {
    cache.set("key1", "value");
    expect(cache.get("key1")).toBe("value");

    await new Promise((r) => setTimeout(r, 150));
    expect(cache.get("key1")).toBeUndefined();
  });

  it("evicts oldest when maxSize exceeded", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");
    cache.set("d", "4"); // should evict "a"

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("d")).toBe("4");
    expect(cache.size).toBe(3);
  });

  it("delete removes a specific key", () => {
    cache.set("key1", "value");
    expect(cache.delete("key1")).toBe(true);
    expect(cache.get("key1")).toBeUndefined();
  });

  it("clear removes all entries", () => {
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("invalidateByPrefix removes matching entries", () => {
    cache.set("users:1", "a");
    cache.set("users:2", "b");
    cache.set("posts:1", "c");

    const count = cache.invalidateByPrefix("users:");
    expect(count).toBe(2);
    expect(cache.get("users:1")).toBeUndefined();
    expect(cache.get("posts:1")).toBe("c");
  });
});

describe("ResponseCache.key()", () => {
  it("returns pathname for null/undefined input", () => {
    expect(ResponseCache.key("health", undefined)).toBe("health");
    expect(ResponseCache.key("health", null)).toBe("health");
  });

  it("generates deterministic keys for objects", () => {
    const k1 = ResponseCache.key("users/list", { limit: 10 });
    const k2 = ResponseCache.key("users/list", { limit: 10 });
    expect(k1).toBe(k2);
  });

  it("different inputs produce different keys", () => {
    const k1 = ResponseCache.key("users/list", { limit: 10 });
    const k2 = ResponseCache.key("users/list", { limit: 20 });
    expect(k1).not.toBe(k2);
  });

  it("key order doesn't matter (ohash serializes deterministically)", () => {
    const k1 = ResponseCache.key("test", { a: 1, b: 2 });
    const k2 = ResponseCache.key("test", { b: 2, a: 1 });
    expect(k1).toBe(k2);
  });

  it("handles complex inputs (Date, nested)", () => {
    const k1 = ResponseCache.key("test", { date: new Date("2026-01-01"), nested: { x: 1 } });
    const k2 = ResponseCache.key("test", { date: new Date("2026-01-01"), nested: { x: 1 } });
    expect(k1).toBe(k2);
  });
});
