import { describe, it, expect } from "vitest";
import {
  KatmanError,
  isDefinedError,
  toKatmanError,
  isKatmanErrorJSON,
  fromKatmanErrorJSON,
} from "#src/core/error.ts";
import { once, mergeHeaders } from "#src/core/utils.ts";
import { validateSchema, type as typeSchema } from "#src/core/schema.ts";
import { AsyncIteratorClass } from "#src/core/iterator.ts";

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
