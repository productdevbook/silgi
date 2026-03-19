/**
 * Client proxy tests — inspired by oRPC's client.test.ts patterns.
 * Tests path accumulation, signal forwarding, symbol handling, safe().
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createClient, safe } from "../src/client/client.ts";
import type { ClientLink, ClientContext, ClientOptions } from "../src/client/types.ts";

describe("createClient proxy", () => {
  const mockedLink: ClientLink = {
    call: vi.fn().mockResolvedValue("__mocked__"),
  };

  beforeEach(() => vi.clearAllMocks());

  it("calls link with correct path and input", async () => {
    const client = createClient<any>(mockedLink);

    const result = await client.ping({ value: "hello" });
    expect(result).toBe("__mocked__");
    expect(mockedLink.call).toHaveBeenCalledTimes(1);
    expect(mockedLink.call).toHaveBeenCalledWith(
      ["ping"],
      { value: "hello" },
      expect.any(Object),
    );
  });

  it("accumulates nested paths", async () => {
    const client = createClient<any>(mockedLink);

    await client.nested.deep.procedure({ x: 1 });
    expect(mockedLink.call).toHaveBeenCalledWith(
      ["nested", "deep", "procedure"],
      { x: 1 },
      expect.any(Object),
    );
  });

  it("passes signal through options", async () => {
    const client = createClient<any>(mockedLink);
    const controller = new AbortController();

    await client.test("input", { signal: controller.signal });
    expect(mockedLink.call).toHaveBeenCalledWith(
      ["test"],
      "input",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("returns undefined for Symbol properties (prevent native await)", () => {
    const client = createClient<any>(mockedLink);
    expect((client as any)[Symbol("test")]).toBeUndefined();
    expect((client as any).then).toBeUndefined();
  });

  it("caches sub-proxies", () => {
    const client = createClient<any>(mockedLink);
    const users1 = client.users;
    const users2 = client.users;
    expect(users1).toBe(users2); // same reference = cached
  });

  it("works without input", async () => {
    const client = createClient<any>(mockedLink);
    await client.health();
    expect(mockedLink.call).toHaveBeenCalledWith(
      ["health"],
      undefined,
      expect.any(Object),
    );
  });
});

describe("safe()", () => {
  it("returns data on success", async () => {
    const result = await safe(Promise.resolve(42));
    expect(result.error).toBeNull();
    expect(result.data).toBe(42);
    expect(result.isError).toBe(false);
    expect(result.isSuccess).toBe(true);
  });

  it("returns error on failure", async () => {
    const error = new Error("boom");
    const result = await safe(Promise.reject(error));
    expect(result.error).toBe(error);
    expect(result.data).toBeUndefined();
    expect(result.isError).toBe(true);
    expect(result.isSuccess).toBe(false);
  });

  it("handles typed errors", async () => {
    const { KatmanError } = await import("../src/core/error.ts");
    const err = new KatmanError("NOT_FOUND", { status: 404, message: "nope" });
    const result = await safe<string, typeof err>(Promise.reject(err));
    expect(result.isError).toBe(true);
    expect(result.error?.code).toBe("NOT_FOUND");
  });
});

describe("DynamicLink", () => {
  it("resolves link per-call based on path and options", async () => {
    const { DynamicLink } = await import("../src/client/dynamic-link.ts");

    const linkA = { call: vi.fn().mockResolvedValue("A") };
    const linkB = { call: vi.fn().mockResolvedValue("B") };

    const dynamic = new DynamicLink((path, _input, options) => {
      if ((options as any).context?.admin) return linkA;
      return linkB;
    });

    const r1 = await dynamic.call(["test"], {}, { context: { admin: true } } as any);
    expect(r1).toBe("A");
    expect(linkA.call).toHaveBeenCalledTimes(1);

    const r2 = await dynamic.call(["test"], {}, {} as any);
    expect(r2).toBe("B");
    expect(linkB.call).toHaveBeenCalledTimes(1);
  });
});

describe("withInterceptors", () => {
  it("measures duration in onResponse", async () => {
    const { withInterceptors } = await import("../src/client/interceptor.ts");

    let measuredDuration = 0;
    const baseLink = {
      call: vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r("ok"), 50))),
    };

    const link = withInterceptors(baseLink, {
      onResponse: ({ durationMs }) => { measuredDuration = durationMs; },
    });

    await link.call(["test"], {}, {} as any);
    expect(measuredDuration).toBeGreaterThan(10);
  });

  it("propagates errors after onError", async () => {
    const { withInterceptors } = await import("../src/client/interceptor.ts");

    const capturedErrors: unknown[] = [];
    const baseLink = { call: vi.fn().mockRejectedValue(new Error("fail")) };

    const link = withInterceptors(baseLink, {
      onError: ({ error }) => { capturedErrors.push(error); },
    });

    await expect(link.call(["x"], {}, {} as any)).rejects.toThrow("fail");
    expect(capturedErrors).toHaveLength(1);
    expect((capturedErrors[0] as Error).message).toBe("fail");
  });
});
