/**
 * MessagePack binary protocol — integration tests.
 *
 * Tests binary encode/decode, content negotiation, and
 * end-to-end binary transport via ofetch client.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { katman } from "../src/katman.ts";
import { createClient } from "../src/client/client.ts";
import { createLink } from "../src/client/adapters/ofetch/index.ts";
import { encode, decode, acceptsMsgpack, isMsgpack, MSGPACK_CONTENT_TYPE } from "../src/codec/msgpack.ts";
import type { InferClient } from "../src/types.ts";
import { createServer, type Server } from "node:http";

// ── Codec Unit Tests ────────────────────────────────

describe("msgpack codec", () => {
  it("encodes and decodes primitives", () => {
    const values = [42, "hello", true, null, 3.14];
    for (const v of values) {
      expect(decode(new Uint8Array(encode(v) as ArrayBuffer))).toEqual(v);
    }
  });

  it("encodes and decodes objects", () => {
    const obj = { name: "Alice", age: 30, tags: ["admin", "user"] };
    const buf = encode(obj);
    expect(buf.byteLength).toBeLessThan(JSON.stringify(obj).length); // smaller than JSON
    expect(decode(new Uint8Array(buf as ArrayBuffer))).toEqual(obj);
  });

  it("encodes and decodes Date", () => {
    const date = new Date("2026-03-18T00:00:00Z");
    const decoded = decode(new Uint8Array(encode(date) as ArrayBuffer));
    expect(decoded).toEqual(date);
  });

  it("encodes and decodes nested objects", () => {
    const nested = { users: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }], total: 2 };
    expect(decode(new Uint8Array(encode(nested) as ArrayBuffer))).toEqual(nested);
  });

  it("acceptsMsgpack detects accept header", () => {
    expect(acceptsMsgpack("application/x-msgpack")).toBe(true);
    expect(acceptsMsgpack("application/msgpack")).toBe(true);
    expect(acceptsMsgpack("application/json")).toBe(false);
    expect(acceptsMsgpack(null)).toBe(false);
  });

  it("isMsgpack detects content-type", () => {
    expect(isMsgpack("application/x-msgpack")).toBe(true);
    expect(isMsgpack("application/json")).toBe(false);
  });
});

// ── End-to-End Binary Transport ─────────────────────

describe("binary transport (end-to-end)", () => {
  const k = katman({ context: () => ({ db: true }) });
  const { query, mutation, router } = k;

  const appRouter = router({
    health: query(() => ({ status: "ok", ts: Date.now() })),
    echo: query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
    add: mutation(z.object({ a: z.number(), b: z.number() }), ({ input }) => ({ sum: input.a + input.b })),
  });

  const handle = k.handler(appRouter);
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const url = `http://localhost${req.url}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value) headers.set(key, Array.isArray(value) ? value[0]! : value);
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const bodyBuf = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

      const fetchReq = new Request(url, {
        method: req.method,
        headers,
        body: bodyBuf,
      });

      const fetchRes = await handle(fetchReq);
      const resHeaders: Record<string, string> = {};
      fetchRes.headers.forEach((v, k) => { resHeaders[k] = v; });
      const resBuf = Buffer.from(await fetchRes.arrayBuffer());
      res.writeHead(fetchRes.status, resHeaders);
      res.end(resBuf);
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => { server?.close(); });

  it("server responds with msgpack when Accept: application/x-msgpack", async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: "POST",
      headers: { accept: MSGPACK_CONTENT_TYPE },
    });
    expect(res.headers.get("content-type")).toBe(MSGPACK_CONTENT_TYPE);
    const buf = new Uint8Array(await res.arrayBuffer());
    const data = decode(buf) as any;
    expect(data.status).toBe("ok");
  });

  it("server responds with JSON by default", async () => {
    const res = await fetch(`${baseUrl}/health`, { method: "POST" });
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("server decodes msgpack request body", async () => {
    const body = encode({ msg: "hello binary" });
    const res = await fetch(`${baseUrl}/echo`, {
      method: "POST",
      headers: {
        "content-type": MSGPACK_CONTENT_TYPE,
        accept: MSGPACK_CONTENT_TYPE,
      },
      body,
    });
    expect(res.headers.get("content-type")).toBe(MSGPACK_CONTENT_TYPE);
    const data = decode(new Uint8Array(await res.arrayBuffer())) as any;
    expect(data.echo).toBe("hello binary");
  });

  it("ofetch client with binary: true works end-to-end", async () => {
    const link = createLink({ url: baseUrl, binary: true });
    const client = createClient<InferClient<typeof appRouter>>(link);

    const result = await client.echo({ msg: "binary rpc" });
    expect(result.echo).toBe("binary rpc");
  });

  it("ofetch binary client handles mutations", async () => {
    const link = createLink({ url: baseUrl, binary: true });
    const client = createClient<InferClient<typeof appRouter>>(link);

    const result = await client.add({ a: 10, b: 32 });
    expect(result.sum).toBe(42);
  });

  it("ofetch binary client handles no-input queries", async () => {
    const link = createLink({ url: baseUrl, binary: true });
    const client = createClient<InferClient<typeof appRouter>>(link);

    const result = await client.health();
    expect(result.status).toBe("ok");
  });

  it("binary payload is smaller than JSON", () => {
    const data = { users: Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User ${i}`, active: true })) };
    const jsonSize = JSON.stringify(data).length;
    const msgpackSize = (encode(data) as ArrayBuffer).byteLength;
    expect(msgpackSize).toBeLessThan(jsonSize);
  });
});
