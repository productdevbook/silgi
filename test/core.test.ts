import { describe, it, expect } from "vitest";
import {
  KatmanError,
  isDefinedError,
  toKatmanError,
  isKatmanErrorJSON,
  fromKatmanErrorJSON,
} from "../src/core/error.ts";
import { once, sequential, mergeHeaders, mergeAbortSignals } from "../src/core/utils.ts";
import { compilePipeline, mergeMiddlewares, startsWithMiddlewares } from "../src/core/pipeline.ts";
import { intercept, onStart, onSuccess, onError, onFinish } from "../src/core/interceptor.ts";
import { JsonSerializer, TypeCode } from "../src/core/codec.ts";
import { validateSchema, type as typeSchema, ValidationError } from "../src/core/schema.ts";
import { AsyncIteratorClass, mapAsyncIterator } from "../src/core/iterator.ts";
import { createCachedProxy } from "../src/core/proxy.ts";

// === KatmanError ===
describe("KatmanError", () => {
  it("creates with default status and message", () => {
    const err = new KatmanError("NOT_FOUND");
    expect(err.code).toBe("NOT_FOUND");
    expect(err.status).toBe(404);
    expect(err.message).toBe("Not Found");
    expect(err.defined).toBe(false);
  });

  it("creates with custom status and message", () => {
    const err = new KatmanError("CUSTOM", { status: 418, message: "I'm a teapot" });
    expect(err.status).toBe(418);
    expect(err.message).toBe("I'm a teapot");
  });

  it("serializes to JSON", () => {
    const err = new KatmanError("BAD_REQUEST", { data: { field: "name" }, defined: true });
    const json = err.toJSON();
    expect(json.code).toBe("BAD_REQUEST");
    expect(json.status).toBe(400);
    expect(json.data).toEqual({ field: "name" });
    expect(json.defined).toBe(true);
  });

  it("instanceof works", () => {
    const err = new KatmanError("UNAUTHORIZED");
    expect(err instanceof KatmanError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("isDefinedError works", () => {
    const defined = new KatmanError("CONFLICT", { defined: true });
    const notDefined = new KatmanError("CONFLICT", { defined: false });
    expect(isDefinedError(defined)).toBe(true);
    expect(isDefinedError(notDefined)).toBe(false);
  });

  it("toKatmanError wraps unknown errors", () => {
    const err = toKatmanError(new Error("boom"));
    expect(err.code).toBe("INTERNAL_SERVER_ERROR");
    expect(err.message).toBe("boom");
  });

  it("toKatmanError passes through KatmanError", () => {
    const original = new KatmanError("NOT_FOUND");
    expect(toKatmanError(original)).toBe(original);
  });

  it("isKatmanErrorJSON validates shape", () => {
    expect(isKatmanErrorJSON({ code: "X", status: 400, message: "x" })).toBe(true);
    expect(isKatmanErrorJSON({ code: 123 })).toBe(false);
    expect(isKatmanErrorJSON(null)).toBe(false);
  });

  it("fromKatmanErrorJSON reconstructs", () => {
    const err = fromKatmanErrorJSON({ defined: true, code: "CONFLICT", status: 409, message: "dup", data: null });
    expect(err.code).toBe("CONFLICT");
    expect(err.status).toBe(409);
    expect(err.defined).toBe(true);
  });
});

// === Utils ===
describe("utils", () => {
  it("once memoizes", async () => {
    let count = 0;
    const fn = once(async () => ++count);
    expect(await fn()).toBe(1);
    expect(await fn()).toBe(1);
  });

  it("mergeHeaders combines multi-value", () => {
    const result = mergeHeaders(
      { "x-a": "1", "x-b": "2" },
      { "x-a": "3", "x-c": "4" },
    );
    expect(result["x-a"]).toEqual(["1", "3"]);
    expect(result["x-b"]).toBe("2");
    expect(result["x-c"]).toBe("4");
  });
});

// === Pipeline ===
describe("compilePipeline", () => {
  it("executes handler directly with no middleware", async () => {
    const pipeline = compilePipeline(
      [],
      async ({ input }) => (input as number) * 2,
      undefined,
      undefined,
      { inputValidationIndex: 0, outputValidationIndex: 0 },
    );
    const result = await pipeline({}, 21, AbortSignal.timeout(5000), [], {}, {});
    expect(result).toBe(42);
  });

  it("executes middleware chain", async () => {
    const order: string[] = [];

    const mw1 = async (opts: any, input: any) => {
      order.push("mw1-before");
      const result = await opts.next({ context: { user: "alice" } });
      order.push("mw1-after");
      return result;
    };

    const mw2 = async (opts: any, input: any) => {
      order.push("mw2-before");
      const result = await opts.next();
      order.push("mw2-after");
      return result;
    };

    const pipeline = compilePipeline(
      [mw1, mw2],
      async ({ context, input }) => {
        order.push("handler");
        return `${(context as any).user}-${input}`;
      },
      undefined,
      undefined,
      { inputValidationIndex: 0, outputValidationIndex: 0 },
    );

    const result = await pipeline({}, "test", AbortSignal.timeout(5000), [], {}, {});
    expect(result).toBe("alice-test");
    expect(order).toEqual(["mw1-before", "mw2-before", "handler", "mw2-after", "mw1-after"]);
  });

  it("applies input validation at correct position", async () => {
    const validated: unknown[] = [];

    const mw = async (opts: any, input: any) => {
      validated.push(`mw:${input}`);
      return opts.next();
    };

    const pipeline = compilePipeline(
      [mw],
      async ({ input }) => input,
      async (input) => {
        validated.push(`validate:${input}`);
        return `validated-${input}`;
      },
      undefined,
      { inputValidationIndex: 0, outputValidationIndex: 999 },
    );

    const result = await pipeline({}, "raw", AbortSignal.timeout(5000), [], {}, {});
    expect(validated).toEqual(["validate:raw", "mw:validated-raw"]);
    expect(result).toBe("validated-raw");
  });
});

describe("mergeMiddlewares", () => {
  it("concatenates without dedupe", () => {
    const a = [() => {}, () => {}] as any[];
    const b = [() => {}] as any[];
    expect(mergeMiddlewares(a, b)).toHaveLength(3);
  });

  it("dedupes leading middlewares", () => {
    const shared = () => {};
    const a = [shared] as any[];
    const b = [shared, () => {}] as any[];
    expect(mergeMiddlewares(a, b, true)).toHaveLength(2);
  });
});

// === Interceptor ===
describe("interceptor", () => {
  it("chains interceptors in onion order", async () => {
    const order: string[] = [];
    const interceptors = [
      async (opts: any) => { order.push("a"); const r = await opts.next(); order.push("a-after"); return r; },
      async (opts: any) => { order.push("b"); return opts.next(); },
    ];
    await intercept(interceptors as any, {}, async () => { order.push("exec"); return "ok"; });
    expect(order).toEqual(["a", "b", "exec", "a-after"]);
  });

  it("empty interceptors executes directly", async () => {
    const result = await intercept([], {}, async () => 42);
    expect(result).toBe(42);
  });
});

// === Codec ===
describe("JsonSerializer", () => {
  const s = new JsonSerializer();

  it("handles primitives", () => {
    const { json, meta } = s.serialize("hello");
    expect(json).toBe("hello");
    expect(meta).toEqual([]);
  });

  it("handles Date", () => {
    const date = new Date("2024-01-01");
    const { json, meta } = s.serialize(date);
    expect(json).toBe(date.toISOString());
    expect(meta).toEqual([[TypeCode.Date]]);
    expect(s.deserialize(json, meta)).toEqual(date);
  });

  it("handles BigInt", () => {
    const { json, meta } = s.serialize(42n);
    expect(json).toBe("42");
    expect(meta).toEqual([[TypeCode.BigInt]]);
  });

  it("handles Set", () => {
    const { json, meta } = s.serialize(new Set([1, 2, 3]));
    expect(json).toEqual([1, 2, 3]);
    expect(meta[0]![0]).toBe(TypeCode.Set);
  });

  it("handles Map", () => {
    const { json, meta } = s.serialize(new Map([["a", 1]]));
    expect(json).toEqual([["a", 1]]);
    expect(meta[0]![0]).toBe(TypeCode.Map);
  });

  it("handles nested objects", () => {
    const input = { user: { name: "alice", joined: new Date("2024-01-01") } };
    const { json, meta } = s.serialize(input);
    const restored = s.deserialize(json, meta) as typeof input;
    expect(restored.user.name).toBe("alice");
    expect(restored.user.joined).toEqual(new Date("2024-01-01"));
  });

  it("handles undefined", () => {
    const { json, meta } = s.serialize(undefined);
    expect(json).toBe(null);
    expect(meta).toEqual([[TypeCode.Undefined]]);
  });

  it("handles NaN", () => {
    const { json, meta } = s.serialize(NaN);
    expect(json).toBe("NaN");
    expect(meta[0]![0]).toBe(TypeCode.NaN);
  });

  it("handles URL", () => {
    const url = new URL("https://example.com/path");
    const { json, meta } = s.serialize(url);
    expect(json).toBe("https://example.com/path");
    expect(meta[0]![0]).toBe(TypeCode.URL);
  });

  it("handles RegExp", () => {
    const regex = /test/gi;
    const { json, meta } = s.serialize(regex);
    expect(json).toBe("/test/gi");
    expect(meta[0]![0]).toBe(TypeCode.RegExp);
  });

  it("extracts Blobs", () => {
    const blob = new Blob(["hello"]);
    const { maps, blobs } = s.serialize(blob);
    expect(maps).toHaveLength(1);
    expect(blobs).toHaveLength(1);
    expect(blobs[0]).toBe(blob);
  });
});

// === Schema ===
describe("schema", () => {
  it("type() creates a passthrough schema", async () => {
    const schema = typeSchema<string>();
    const result = await validateSchema(schema, "hello");
    expect(result).toBe("hello");
  });

  it("type() with mapper transforms", async () => {
    const schema = typeSchema<string, number>((s) => s.length);
    const result = await validateSchema(schema, "hello");
    expect(result).toBe(5);
  });
});

// === AsyncIteratorClass ===
describe("AsyncIteratorClass", () => {
  it("iterates values", async () => {
    let i = 0;
    const iter = new AsyncIteratorClass<number>(async () => {
      if (i >= 3) return { done: true, value: undefined as unknown as number };
      return { done: false, value: i++ };
    });

    const values: number[] = [];
    for await (const v of iter) values.push(v);
    expect(values).toEqual([0, 1, 2]);
  });

  it("calls cleanup on natural completion", async () => {
    let cleaned = false;
    const iter = new AsyncIteratorClass<number>(
      async () => ({ done: true, value: undefined as unknown as number }),
      async () => { cleaned = true; },
    );
    await iter.next();
    expect(cleaned).toBe(true);
  });

  it("calls cleanup on return()", async () => {
    let cleanupReason = "";
    const iter = new AsyncIteratorClass<number>(
      async () => ({ done: false, value: 1 }),
      async (reason) => { cleanupReason = reason; },
    );
    await iter.return();
    expect(cleanupReason).toBe("return");
  });
});

// === Cached Proxy ===
describe("createCachedProxy", () => {
  it("accumulates path and calls handler", () => {
    const calls: unknown[] = [];
    const proxy = createCachedProxy<any>((path, args) => {
      calls.push({ path, args });
      return "result";
    });

    proxy.users.list("arg1");
    expect(calls).toEqual([{ path: ["users", "list"], args: ["arg1"] }]);
  });

  it("caches sub-proxies", () => {
    const proxy = createCachedProxy<any>(() => {});
    expect(proxy.users).toBe(proxy.users);
    expect(proxy.users.list).toBe(proxy.users.list);
  });
});
