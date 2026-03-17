import { describe, it, expect, vi } from "vitest";
import { createClient, safe } from "../src/client/client.ts";
import { DynamicLink } from "../src/client/dynamic-link.ts";
import type { ClientLink } from "../src/client/types.ts";

describe("createClient", () => {
  it("creates a callable proxy", async () => {
    const mockLink: ClientLink = {
      call: vi.fn(async (path, input) => `result-${path.join(".")}-${input}`),
    };

    const client = createClient<any>(mockLink);
    const result = await client.users.list("arg");
    expect(result).toBe("result-users.list-arg");
    expect(mockLink.call).toHaveBeenCalledWith(
      ["users", "list"],
      "arg",
      expect.any(Object),
    );
  });

  it("caches sub-proxies", () => {
    const mockLink: ClientLink = { call: vi.fn(async () => null) };
    const client = createClient<any>(mockLink);
    expect(client.users).toBe(client.users);
    expect(client.users.list).toBe(client.users.list);
  });

  it("does not resolve as thenable", async () => {
    const mockLink: ClientLink = { call: vi.fn(async () => null) };
    const client = createClient<any>(mockLink);
    // Should not trigger .then
    expect(client.then).toBeUndefined();
  });
});

describe("safe", () => {
  it("returns success result", async () => {
    const result = await safe(Promise.resolve("hello"));
    expect(result.isSuccess).toBe(true);
    expect(result.data).toBe("hello");
    expect(result.error).toBeNull();
  });

  it("returns error result", async () => {
    const result = await safe(Promise.reject(new Error("boom")));
    expect(result.isError).toBe(true);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.data).toBeUndefined();
  });
});

describe("DynamicLink", () => {
  it("resolves link per request", async () => {
    const link1: ClientLink = { call: vi.fn(async () => "from-link1") };
    const link2: ClientLink = { call: vi.fn(async () => "from-link2") };

    const dynamic = new DynamicLink(async (path) =>
      path[0] === "admin" ? link1 : link2,
    );

    const result1 = await dynamic.call(["admin", "list"], null, {});
    const result2 = await dynamic.call(["users", "list"], null, {});

    expect(result1).toBe("from-link1");
    expect(result2).toBe("from-link2");
  });
});
