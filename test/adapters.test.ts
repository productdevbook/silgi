/**
 * Tests for framework adapters: Next.js, Remix, Astro, SolidStart,
 * SvelteKit, Elysia, MessagePort, OpenAPI Client
 */

import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { katman } from "../src/katman.ts";
import { katmanLambda } from "../src/adapters/aws-lambda.ts";

const k = katman({ context: () => ({ db: "test" }) });

const testRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ hello: input.name })),
});

// ── MessagePort ────────────────────────────────────────

describe("MessagePort adapter", () => {
  it("handles RPC over message port", async () => {
    const { katmanMessagePort, MessagePortLink } = await import("../src/adapters/message-port.ts");
    const { createClient } = await import("../src/client/client.ts");

    // Create a mock MessageChannel
    const channel = new MessageChannel();

    // Server side
    const dispose = katmanMessagePort(testRouter, channel.port1, {
      context: () => ({ db: "test" }),
    });

    // Client side
    const link = new MessagePortLink(channel.port2);
    const client = createClient<any>(link);

    const result = await client.health();
    expect(result).toEqual({ status: "ok" });

    const echo = await client.echo({ msg: "hello" });
    expect(echo).toEqual({ echo: "hello" });

    dispose();
    channel.port1.close();
    channel.port2.close();
  });

  it("returns error for unknown procedure", async () => {
    const { katmanMessagePort, MessagePortLink } = await import("../src/adapters/message-port.ts");
    const { createClient } = await import("../src/client/client.ts");

    const channel = new MessageChannel();
    const dispose = katmanMessagePort(testRouter, channel.port1, {
      context: () => ({}),
    });

    const link = new MessagePortLink(channel.port2);
    const client = createClient<any>(link);

    await expect(client.nonexistent()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    dispose();
    channel.port1.close();
    channel.port2.close();
  });
});

// ── OpenAPI Client Link ────────────────────────────────

describe("OpenAPILink", () => {
  it("makes POST requests by default", async () => {
    const { OpenAPILink } = await import("../src/client/openapi.ts");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const link = new OpenAPILink({
      url: "https://api.example.com",
      fetch: mockFetch,
    });

    const result = await link.call(["health"], undefined, {});
    expect(result).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/health",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses GET when spec indicates", async () => {
    const { OpenAPILink } = await import("../src/client/openapi.ts");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const link = new OpenAPILink({
      url: "https://api.example.com",
      spec: {
        paths: {
          "/users": { get: {} },
        },
      },
      fetch: mockFetch,
    });

    await link.call(["users"], { limit: 10 }, {});
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=10"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws KatmanError on non-ok response", async () => {
    const { OpenAPILink } = await import("../src/client/openapi.ts");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "nope" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const link = new OpenAPILink({ url: "https://api.example.com", fetch: mockFetch });

    await expect(link.call(["missing"], {}, {})).rejects.toMatchObject({
      status: 404,
    });
  });
});

// ── File Upload Guard ──────────────────────────────────

describe("fileGuard", () => {
  it("throws when no files", () => {
    const { fileGuard } = require("../src/plugins/file-upload.ts");
    const guard = fileGuard();
    expect(() => guard.fn({ __files: [] })).toThrow();
    expect(() => guard.fn({})).toThrow();
  });

  it("throws when file too large", () => {
    const { fileGuard } = require("../src/plugins/file-upload.ts");
    const guard = fileGuard({ maxFileSize: 100 });
    const file = { name: "big.txt", size: 200, type: "text/plain" };
    expect(() => guard.fn({ __files: [file] })).toThrow();
  });

  it("throws when MIME type not allowed", () => {
    const { fileGuard } = require("../src/plugins/file-upload.ts");
    const guard = fileGuard({ allowedTypes: ["image/*"] });
    const file = { name: "doc.pdf", size: 100, type: "application/pdf" };
    expect(() => guard.fn({ __files: [file] })).toThrow();
  });

  it("passes valid files", () => {
    const { fileGuard } = require("../src/plugins/file-upload.ts");
    const guard = fileGuard({ maxFileSize: 1000, allowedTypes: ["image/*"] });
    const file = { name: "photo.jpg", size: 500, type: "image/jpeg" };
    const result = guard.fn({ __files: [file] });
    expect(result).toEqual({ file });
  });

  it("returns files array when maxFiles > 1", () => {
    const { fileGuard } = require("../src/plugins/file-upload.ts");
    const guard = fileGuard({ maxFiles: 3 });
    const files = [
      { name: "a.txt", size: 10, type: "text/plain" },
      { name: "b.txt", size: 20, type: "text/plain" },
    ];
    const result = guard.fn({ __files: files });
    expect(result).toEqual({ files });
  });
});

// ── tRPC Interop ───────────────────────────────────────

describe("fromTRPC()", () => {
  it("converts a mock tRPC router", async () => {
    const { fromTRPC } = await import("../src/trpc-interop.ts");
    const { compileProcedure } = await import("../src/compile.ts");

    // Mock tRPC-like router structure
    const mockRouter = {
      health: {
        _def: {
          type: "query",
          inputs: [],
          resolver: () => ({ status: "ok" }),
        },
      },
      echo: {
        _def: {
          type: "query",
          inputs: [z.object({ msg: z.string() })],
          resolver: ({ input }: any) => ({ echo: input.msg }),
        },
      },
    };

    const katmanRouter = fromTRPC(mockRouter);

    expect(katmanRouter.health).toBeDefined();
    expect((katmanRouter.health as any).type).toBe("query");

    // Compile and call
    const handler = compileProcedure(katmanRouter.health as any);
    const result = await handler({}, undefined, AbortSignal.timeout(5000));
    expect(result).toEqual({ status: "ok" });
  });

  it("throws for invalid input", () => {
    const { fromTRPC } = require("../src/trpc-interop.ts");
    expect(() => fromTRPC(null)).toThrow();
    expect(() => fromTRPC("string")).toThrow();
  });
});

// ── SSR Hydration ──────────────────────────────────────

describe("SSR utilities", () => {
  it("createSSRSerializer handles Date", async () => {
    const { createSSRSerializer } = await import("../src/integrations/tanstack-query/ssr.ts");
    const serializer = createSSRSerializer();

    const data = { created: new Date("2026-01-01"), count: 42 };
    const json = serializer.serialize(data);
    const parsed = serializer.deserialize(json) as typeof data;

    expect(parsed.created).toBeInstanceOf(Date);
    expect(parsed.created.getFullYear()).toBe(2026);
    expect(parsed.count).toBe(42);
  });

  it("createSSRSerializer handles Map and Set", async () => {
    const { createSSRSerializer } = await import("../src/integrations/tanstack-query/ssr.ts");
    const serializer = createSSRSerializer();

    const data = {
      tags: new Set(["a", "b"]),
      meta: new Map([["key", "value"]]),
    };
    const json = serializer.serialize(data);
    const parsed = serializer.deserialize(json) as typeof data;

    expect(parsed.tags).toBeInstanceOf(Set);
    expect(parsed.tags.has("a")).toBe(true);
    expect(parsed.meta).toBeInstanceOf(Map);
    expect(parsed.meta.get("key")).toBe("value");
  });
});
