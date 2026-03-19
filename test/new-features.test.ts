/**
 * Tests for new features: callable, serverClient, lifecycle, mapInput,
 * bodyLimit, strictGet, cookies, signing, coerce, pubsub, serializer,
 * dynamicLink, interceptors, batchHandler, awsLambda
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { katman, KatmanError } from "../src/katman.ts";
import { compileProcedure } from "../src/compile.ts";
import { callable } from "../src/callable.ts";
import { createServerClient } from "../src/client/server.ts";
import { lifecycleWrap } from "../src/lifecycle.ts";
import { bodyLimitGuard } from "../src/plugins/body-limit.ts";
import { strictGetGuard } from "../src/plugins/strict-get.ts";
import { getCookie, parseCookies, setCookie, deleteCookie } from "../src/plugins/cookies.ts";
import { sign, unsign, encrypt, decrypt } from "../src/plugins/signing.ts";
import { coerceValue, coerceObject } from "../src/plugins/coerce.ts";
import { createPublisher, MemoryPubSub } from "../src/plugins/pubsub.ts";
import { createSerializer } from "../src/plugins/custom-serializer.ts";
import { DynamicLink } from "../src/client/dynamic-link.ts";
import { withInterceptors } from "../src/client/interceptor.ts";
import { mergeClients } from "../src/client/merge.ts";
import { createBatchHandler } from "../src/plugins/batch-server.ts";
import { katmanLambda } from "../src/adapters/aws-lambda.ts";

const k = katman({ context: () => ({ db: "test" }) });

// ── callable() ────────────────────────────────────────

describe("callable()", () => {
  it("calls a procedure directly without HTTP", async () => {
    const proc = k.query(
      z.object({ limit: z.number() }),
      ({ input }) => ({ items: input.limit }),
    );

    const fn = callable(proc, { context: () => ({ db: "test" }) });
    const result = await fn({ limit: 5 });
    expect(result).toEqual({ items: 5 });
  });

  it("runs guards in callable", async () => {
    const auth = k.guard(() => ({ userId: 42 }));
    const proc = k.query({
      use: [auth],
      resolve: ({ ctx }) => ({ user: (ctx as any).userId }),
    });

    const fn = callable(proc, { context: () => ({}) });
    const result = await fn();
    expect(result).toEqual({ user: 42 });
  });
});

// ── createServerClient() ──────────────────────────────

describe("createServerClient()", () => {
  it("calls procedures in-process", async () => {
    const router = k.router({
      health: k.query(() => ({ status: "ok" })),
      users: {
        list: k.query(
          z.object({ limit: z.number().optional() }),
          ({ input }) => ({ count: input.limit ?? 10 }),
        ),
      },
    });

    const client = createServerClient(router, {
      context: () => ({ db: "test" }),
    });

    const health = await (client as any).health();
    expect(health).toEqual({ status: "ok" });

    const users = await (client as any).users.list({ limit: 3 });
    expect(users).toEqual({ count: 3 });
  });
});

// ── lifecycleWrap ─────────────────────────────────────

describe("lifecycleWrap()", () => {
  it("calls onStart and onSuccess", async () => {
    const events: string[] = [];
    const lc = lifecycleWrap({
      onStart: () => { events.push("start"); },
      onSuccess: () => { events.push("success"); },
      onFinish: () => { events.push("finish"); },
    });

    const proc = compileProcedure({
      type: "query", input: null, output: null, errors: null,
      use: [lc], resolve: () => "ok", route: null, meta: null,
    });

    await proc({}, undefined, AbortSignal.timeout(5000));
    expect(events).toEqual(["start", "success", "finish"]);
  });

  it("calls onError on failure", async () => {
    const events: string[] = [];
    const lc = lifecycleWrap({
      onError: () => { events.push("error"); },
      onFinish: () => { events.push("finish"); },
    });

    const proc = compileProcedure({
      type: "query", input: null, output: null, errors: null,
      use: [lc], resolve: () => { throw new Error("boom"); }, route: null, meta: null,
    });

    await expect(proc({}, undefined, AbortSignal.timeout(5000))).rejects.toThrow("boom");
    expect(events).toEqual(["error", "finish"]);
  });
});

// ── mapInput ──────────────────────────────────────────

describe("mapInput()", () => {
  it("creates a wrap middleware", () => {
    const { mapInput } = require("../src/map-input.ts");
    const mapper = mapInput((input: any) => ({ id: input.userId }));
    expect(mapper.kind).toBe("wrap");
    expect(typeof mapper.fn).toBe("function");
  });
});

// ── bodyLimitGuard ────────────────────────────────────

describe("bodyLimitGuard()", () => {
  it("passes when under limit", () => {
    const guard = bodyLimitGuard({ maxBytes: 1000 });
    expect(() => guard.fn({ headers: { "content-length": "500" } })).not.toThrow();
  });

  it("throws when over limit", () => {
    const guard = bodyLimitGuard({ maxBytes: 100 });
    expect(() => guard.fn({ headers: { "content-length": "200" } })).toThrow();
  });

  it("passes when no content-length", () => {
    const guard = bodyLimitGuard({ maxBytes: 100 });
    expect(() => guard.fn({ headers: {} })).not.toThrow();
  });
});

// ── strictGetGuard ────────────────────────────────────

describe("strictGetGuard", () => {
  it("passes for GET", () => {
    expect(() => strictGetGuard.fn({ method: "GET" })).not.toThrow();
  });

  it("passes for HEAD", () => {
    expect(() => strictGetGuard.fn({ method: "HEAD" })).not.toThrow();
  });

  it("throws for POST", () => {
    expect(() => strictGetGuard.fn({ method: "POST" })).toThrow();
  });

  it("passes when no method info", () => {
    expect(() => strictGetGuard.fn({})).not.toThrow();
  });
});

// ── Cookies ───────────────────────────────────────────

describe("Cookie helpers", () => {
  it("getCookie extracts a cookie", () => {
    expect(getCookie({ cookie: "a=1; b=2; c=3" }, "b")).toBe("2");
    expect(getCookie({ cookie: "session=abc123" }, "session")).toBe("abc123");
    expect(getCookie({ cookie: "a=1" }, "x")).toBeUndefined();
  });

  it("parseCookies returns all cookies", () => {
    const result = parseCookies({ cookie: "a=1; b=2" });
    expect(result).toEqual({ a: "1", b: "2" });
  });

  it("setCookie creates header value", () => {
    const header = setCookie("session", "abc", { maxAge: 3600, httpOnly: true, secure: false, sameSite: "lax" });
    expect(header).toContain("session=abc");
    expect(header).toContain("Max-Age=3600");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
  });

  it("deleteCookie sets Max-Age=0", () => {
    const header = deleteCookie("session");
    expect(header).toContain("Max-Age=0");
  });
});

// ── Signing & Encryption ──────────────────────────────

describe("Signing", () => {
  it("sign and unsign round-trip", async () => {
    const signed = await sign("hello", "secret");
    expect(signed).toContain("hello.");
    const value = await unsign(signed, "secret");
    expect(value).toBe("hello");
  });

  it("unsign returns null for tampered value", async () => {
    const signed = await sign("hello", "secret");
    const tampered = signed.replace("hello", "hacked");
    expect(await unsign(tampered, "secret")).toBeNull();
  });

  it("unsign returns null for wrong secret", async () => {
    const signed = await sign("hello", "secret1");
    expect(await unsign(signed, "secret2")).toBeNull();
  });
});

describe("Encryption", () => {
  it("encrypt and decrypt round-trip", async () => {
    const encrypted = await encrypt("secret data", "my-key");
    expect(encrypted).not.toContain("secret data");
    const decrypted = await decrypt(encrypted, "my-key");
    expect(decrypted).toBe("secret data");
  });

  it("different encryptions produce different ciphertexts", async () => {
    const a = await encrypt("same", "key");
    const b = await encrypt("same", "key");
    expect(a).not.toBe(b);
  });
});

// ── Coercion ──────────────────────────────────────────

describe("Smart coercion", () => {
  it("coerces strings to proper types", () => {
    expect(coerceValue("42")).toBe(42);
    expect(coerceValue("3.14")).toBe(3.14);
    expect(coerceValue("true")).toBe(true);
    expect(coerceValue("false")).toBe(false);
    expect(coerceValue("null")).toBeNull();
    expect(coerceValue("undefined")).toBeUndefined();
    expect(coerceValue("")).toBeUndefined();
    expect(coerceValue("hello")).toBe("hello");
  });

  it("coerceObject transforms object values", () => {
    const obj: Record<string, unknown> = { id: "42", active: "true", name: "Alice" };
    coerceObject(obj);
    expect(obj).toEqual({ id: 42, active: true, name: "Alice" });
  });
});

// ── PubSub ────────────────────────────────────────────

describe("PubSub", () => {
  it("MemoryPubSub publishes and subscribes", async () => {
    const backend = new MemoryPubSub();
    const received: unknown[] = [];

    const unsub = backend.subscribe("test", (data) => received.push(data));

    await backend.publish("test", { id: 1 });
    await backend.publish("test", { id: 2 });

    expect(received).toEqual([{ id: 1 }, { id: 2 }]);

    unsub();

    await backend.publish("test", { id: 3 });
    expect(received).toHaveLength(2); // no more events after unsubscribe
  });

  it("createPublisher.publish dispatches to backend", async () => {
    const backend = new MemoryPubSub();
    const pubsub = createPublisher(backend);
    const received: unknown[] = [];

    backend.subscribe("ch", (data) => received.push(data));
    await pubsub.publish("ch", "hello");

    expect(received).toEqual(["hello"]);
  });
});

// ── Custom Serializer ─────────────────────────────────

describe("Custom serializer", () => {
  it("serializes and deserializes custom types", () => {
    // Use a type that JSON.stringify doesn't handle natively
    const s = createSerializer()
      .register("BigInt", {
        test: (v) => typeof v === "bigint",
        serialize: (v: bigint) => v.toString(),
        deserialize: (v) => BigInt(v as string),
      });

    const data = { count: 42n };
    const json = s.stringify(data);
    expect(json).toContain("__$type");
    expect(json).toContain("BigInt");

    const parsed = s.parse(json) as typeof data;
    expect(typeof parsed.count).toBe("bigint");
    expect(parsed.count).toBe(42n);
  });
});

// ── DynamicLink ───────────────────────────────────────

describe("DynamicLink", () => {
  it("routes to different links based on path", async () => {
    const linkA = { call: vi.fn().mockResolvedValue("a") };
    const linkB = { call: vi.fn().mockResolvedValue("b") };

    const dynamic = new DynamicLink((path) => {
      return path[0] === "admin" ? linkA : linkB;
    });

    await dynamic.call(["admin", "stats"], {}, {});
    expect(linkA.call).toHaveBeenCalled();
    expect(linkB.call).not.toHaveBeenCalled();

    await dynamic.call(["users", "list"], {}, {});
    expect(linkB.call).toHaveBeenCalled();
  });
});

// ── withInterceptors ──────────────────────────────────

describe("withInterceptors", () => {
  it("calls onRequest and onResponse", async () => {
    const events: string[] = [];
    const baseLink = { call: vi.fn().mockResolvedValue("result") };

    const link = withInterceptors(baseLink, {
      onRequest: () => { events.push("request"); },
      onResponse: () => { events.push("response"); },
    });

    await link.call(["test"], {}, {});
    expect(events).toEqual(["request", "response"]);
  });

  it("calls onError on failure", async () => {
    const events: string[] = [];
    const baseLink = { call: vi.fn().mockRejectedValue(new Error("fail")) };

    const link = withInterceptors(baseLink, {
      onError: () => { events.push("error"); },
    });

    await expect(link.call(["test"], {}, {})).rejects.toThrow("fail");
    expect(events).toEqual(["error"]);
  });
});

// ── mergeClients ──────────────────────────────────────

describe("mergeClients", () => {
  it("merges client objects", () => {
    const a = { list: () => "a" };
    const b = { list: () => "b" };
    const merged = mergeClients({ users: a, billing: b });
    expect(merged.users.list()).toBe("a");
    expect(merged.billing.list()).toBe("b");
  });
});

// ── createBatchHandler ────────────────────────────────

describe("createBatchHandler()", () => {
  it("processes multiple calls in one request", async () => {
    const router = k.router({
      health: k.query(() => ({ status: "ok" })),
      echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
    });

    const handler = createBatchHandler(router, { context: () => ({}) });

    const request = new Request("http://localhost/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { path: "health" },
        { path: "echo", input: { msg: "hi" } },
        { path: "nonexistent" },
      ]),
    });

    const response = await handler(request);
    const results = await response.json();

    expect(results).toHaveLength(3);
    expect(results[0].data).toEqual({ status: "ok" });
    expect(results[1].data).toEqual({ echo: "hi" });
    expect(results[2].error.code).toBe("NOT_FOUND");
  });

  it("rejects oversized batches", async () => {
    const router = k.router({ health: k.query(() => "ok") });
    const handler = createBatchHandler(router, { context: () => ({}), maxBatchSize: 2 });

    const request = new Request("http://localhost/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ path: "a" }, { path: "b" }, { path: "c" }]),
    });

    const response = await handler(request);
    expect(response.status).toBe(400);
  });
});

// ── AWS Lambda Adapter ────────────────────────────────

describe("katmanLambda()", () => {
  it("handles Lambda events", async () => {
    const router = k.router({
      health: k.query(() => ({ status: "ok" })),
      echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
    });

    const handler = katmanLambda(router, { context: () => ({}) });

    const result = await handler({
      httpMethod: "POST",
      path: "/echo",
      body: JSON.stringify({ msg: "hello" }),
      headers: { "content-type": "application/json" },
      queryStringParameters: null,
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ echo: "hello" });
  });

  it("returns 404 for unknown procedures", async () => {
    const router = k.router({ health: k.query(() => "ok") });
    const handler = katmanLambda(router, { context: () => ({}) });

    const result = await handler({
      httpMethod: "POST",
      path: "/unknown",
      body: null,
      headers: {},
      queryStringParameters: null,
    });

    expect(result.statusCode).toBe(404);
  });

  it("strips prefix", async () => {
    const router = k.router({ health: k.query(() => ({ ok: true })) });
    const handler = katmanLambda(router, { prefix: "/rpc", context: () => ({}) });

    const result = await handler({
      httpMethod: "POST",
      path: "/rpc/health",
      body: null,
      headers: {},
      queryStringParameters: null,
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });
});
