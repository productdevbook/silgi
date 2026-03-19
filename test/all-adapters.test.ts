/**
 * Real integration tests for ALL framework adapters.
 * Each test starts a real server and makes real HTTP requests.
 */

import { describe, it, expect, afterAll } from "vitest";
import { z } from "zod";
import { katman, KatmanError } from "../src/katman.ts";
import { createServer, type Server } from "node:http";

const k = katman({ context: () => ({ db: "test" }) });

const testRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ hello: input.name })),
  fail: k.query(() => { throw new KatmanError("NOT_FOUND", { message: "nope" }); }),
});

// Helper: start server, return URL + cleanup
function listen(server: Server, port: number): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => server.close(),
      });
    });
  });
}

async function post(url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

// ═══════════════════════════════════════════════════
//  Hono (real Hono instance)
// ═══════════════════════════════════════════════════

describe("katmanHono() — real Hono", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests", async () => {
    const { Hono } = await import("hono");
    const { katmanHono } = await import("../src/adapters/hono.ts");

    const app = new Hono();
    app.all("/rpc/*", katmanHono(testRouter, { prefix: "/rpc" }));

    // Hono has .fetch() — wrap in Node HTTP server
    const server = createServer(async (req, res) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v);
      }
      const body = await new Promise<string>((r) => {
        let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
      });
      const request = new Request(`http://127.0.0.1:5100${req.url}`, {
        method: req.method, headers,
        body: req.method !== "GET" ? body || undefined : undefined,
      });
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });

    ({ url, close } = await listen(server, 5100));

    const r1 = await post(`${url}/rpc/health`);
    expect(r1.status).toBe(200);
    expect(r1.data).toEqual({ status: "ok" });

    const r2 = await post(`${url}/rpc/echo`, { msg: "hono" });
    expect(r2.status).toBe(200);
    expect(r2.data).toEqual({ echo: "hono" });

    const r3 = await post(`${url}/rpc/nonexistent`);
    expect(r3.status).toBe(404);
  });
});

// ═══════════════════════════════════════════════════
//  Express (real Express instance)
// ═══════════════════════════════════════════════════

describe("katmanExpress() — real Express", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests", async () => {
    const express = (await import("express")).default;
    const { katmanExpress } = await import("../src/adapters/express.ts");

    const app = express();
    app.use(express.json());
    app.use("/rpc", katmanExpress(testRouter));

    const server = app.listen(5101, "127.0.0.1");
    url = "http://127.0.0.1:5101";
    close = () => server.close();

    // Wait for listen
    await new Promise(r => setTimeout(r, 100));

    const r1 = await post(`${url}/rpc/health`);
    expect(r1.status).toBe(200);
    expect(r1.data).toEqual({ status: "ok" });

    const r2 = await post(`${url}/rpc/echo`, { msg: "express" });
    expect(r2.status).toBe(200);
    expect(r2.data).toEqual({ echo: "express" });

    const r3 = await post(`${url}/rpc/fail`);
    expect(r3.status).toBe(404);
    expect(r3.data.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════
//  H3 v2 (real H3 instance)
// ═══════════════════════════════════════════════════

describe("katmanH3() — real H3", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests", async () => {
    const { H3 } = await import("h3");
    const { katmanH3 } = await import("../src/adapters/h3.ts");

    const app = new H3();
    const handler = katmanH3(testRouter, { prefix: "/rpc" });
    app.all("/rpc/**", (event: any) => handler(event));

    const server = createServer(async (req, res) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v);
      }
      const body = await new Promise<string>((r) => {
        let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
      });
      const request = new Request(`http://127.0.0.1:5102${req.url}`, {
        method: req.method, headers,
        body: req.method !== "GET" ? body || undefined : undefined,
      });
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });

    ({ url, close } = await listen(server, 5102));

    const r1 = await post(`${url}/rpc/health`);
    expect(r1.status).toBe(200);
    expect(r1.data).toEqual({ status: "ok" });

    const r2 = await post(`${url}/rpc/echo`, { msg: "h3" });
    expect(r2.status).toBe(200);
    expect(r2.data).toEqual({ echo: "h3" });
  });
});

// ═══════════════════════════════════════════════════
//  Next.js / Remix / Astro / SvelteKit / SolidStart
//  (all use Fetch API — test with real Request/Response)
// ═══════════════════════════════════════════════════

describe("katmanNextjs() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanNextjs } = await import("../src/adapters/nextjs.ts");
    const handler = katmanNextjs(testRouter, { prefix: "/api/rpc" });

    const r1 = await handler(new Request("http://localhost/api/rpc/health", { method: "POST" }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });

    const r2 = await handler(new Request("http://localhost/api/rpc/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "nextjs" }),
    }));
    expect(await r2.json()).toEqual({ echo: "nextjs" });

    const r3 = await handler(new Request("http://localhost/api/rpc/unknown", { method: "POST" }));
    expect(r3.status).toBe(404);

    const r4 = await handler(new Request("http://localhost/api/rpc/fail", { method: "POST" }));
    expect(r4.status).toBe(404);
    expect((await r4.json()).code).toBe("NOT_FOUND");
  });
});

describe("katmanRemix() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanRemix } = await import("../src/adapters/remix.ts");
    const handler = katmanRemix(testRouter, { prefix: "/rpc" });

    const r1 = await handler({
      request: new Request("http://localhost/rpc/health", { method: "POST" }),
      params: {},
    });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });

    const r2 = await handler({
      request: new Request("http://localhost/rpc/greet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Remix" }),
      }),
      params: {},
    });
    expect(await r2.json()).toEqual({ hello: "Remix" });
  });
});

describe("katmanAstro() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanAstro } = await import("../src/adapters/astro.ts");
    const handler = katmanAstro(testRouter, { prefix: "/api/rpc" });

    const r1 = await handler({
      request: new Request("http://localhost/api/rpc/health", { method: "POST" }),
      params: {},
    });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });
  });
});

describe("katmanSvelteKit() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanSvelteKit } = await import("../src/adapters/sveltekit.ts");
    const handler = katmanSvelteKit(testRouter, { prefix: "/api/rpc" });

    const r1 = await handler({
      request: new Request("http://localhost/api/rpc/health", { method: "POST" }),
      locals: {},
    });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });
  });
});

describe("katmanSolidStart() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanSolidStart } = await import("../src/adapters/solidstart.ts");
    const handler = katmanSolidStart(testRouter, { prefix: "/api/rpc" });

    const r1 = await handler({
      request: new Request("http://localhost/api/rpc/health", { method: "POST" }),
    });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });
  });
});

// ═══════════════════════════════════════════════════
//  Nitro (real NitroEvent interface)
// ═══════════════════════════════════════════════════

describe("katmanNitro() — real NitroEvent", () => {
  it("handles FS routing with path param", async () => {
    const { katmanNitro } = await import("../src/adapters/nitro.ts");
    const handler = katmanNitro(testRouter);

    const event = {
      url: new URL("http://localhost/rpc/health"),
      path: "/rpc/health",
      req: {
        method: "POST",
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
      },
      res: { headers: new Headers() },
      context: { params: { path: "health" } },
    };

    const result = await handler(event as any);
    expect(result).toEqual({ status: "ok" });
  });

  it("handles prefix mode with body", async () => {
    const { katmanNitro } = await import("../src/adapters/nitro.ts");
    const handler = katmanNitro(testRouter, { prefix: "/rpc" });

    const event = {
      url: new URL("http://localhost/rpc/echo"),
      path: "/rpc/echo",
      req: {
        method: "POST",
        headers: new Headers({ "content-type": "application/json" }),
        json: () => Promise.resolve({ msg: "nitro" }),
        text: () => Promise.resolve(JSON.stringify({ msg: "nitro" })),
      },
      res: { headers: new Headers() },
      context: { params: {} },
    };

    const result = await handler(event as any);
    expect(result).toEqual({ echo: "nitro" });
  });

  it("returns NOT_FOUND for unknown procedures", async () => {
    const { katmanNitro } = await import("../src/adapters/nitro.ts");
    const handler = katmanNitro(testRouter);

    const event = {
      url: new URL("http://localhost/nope"),
      path: "/nope",
      req: {
        method: "POST",
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
      },
      res: { headers: new Headers() },
      context: { params: { path: "nope" } },
    };

    const result = await handler(event as any) as any;
    expect(result.code).toBe("NOT_FOUND");
  });

  it("passes context from Nitro event", async () => {
    const { katmanNitro } = await import("../src/adapters/nitro.ts");
    const ctxRouter = k.router({
      whoami: k.query(({ ctx }) => ({ user: (ctx as any).user })),
    });
    const handler = katmanNitro(ctxRouter, {
      context: (event: any) => ({ user: event.context.auth }),
    });

    const event = {
      url: new URL("http://localhost/whoami"),
      path: "/whoami",
      req: {
        method: "POST",
        headers: new Headers(),
        json: () => Promise.resolve(undefined),
        text: () => Promise.resolve(""),
      },
      res: { headers: new Headers() },
      context: { params: { path: "whoami" }, auth: "Alice" },
    };

    const result = await handler(event as any);
    expect(result).toEqual({ user: "Alice" });
  });

  it("handles validation errors", async () => {
    const { katmanNitro } = await import("../src/adapters/nitro.ts");
    const handler = katmanNitro(testRouter, { prefix: "/rpc" });

    const event = {
      url: new URL("http://localhost/rpc/echo"),
      path: "/rpc/echo",
      req: {
        method: "POST",
        headers: new Headers(),
        json: () => Promise.resolve({ wrong: "field" }),
        text: () => Promise.resolve(""),
      },
      res: { headers: new Headers() },
      context: { params: {} },
    };

    const result = await handler(event as any) as any;
    expect(result.code).toBe("BAD_REQUEST");
    expect(result.status).toBe(400);
  });

  it("handles GET with query params", async () => {
    const { katmanNitro } = await import("../src/adapters/nitro.ts");
    const handler = katmanNitro(testRouter, { prefix: "/rpc" });

    const event = {
      url: new URL("http://localhost/rpc/echo?data=" + encodeURIComponent(JSON.stringify({ msg: "query" }))),
      path: "/rpc/echo",
      req: {
        method: "GET",
        headers: new Headers(),
        json: () => Promise.reject(new Error("no body")),
        text: () => Promise.resolve(""),
      },
      res: { headers: new Headers() },
      context: { params: {} },
    };

    const result = await handler(event as any);
    expect(result).toEqual({ echo: "query" });
  });
});

// ═══════════════════════════════════════════════════
//  Elysia (real Elysia instance)
// ═══════════════════════════════════════════════════

describe("katmanElysia() — real Elysia", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests", async () => {
    const { Elysia } = await import("elysia");
    const { katmanElysia } = await import("../src/adapters/elysia.ts");

    const plugin = katmanElysia(testRouter, { prefix: "/rpc" });

    const app = new Elysia();
    plugin(app);

    // Elysia has .fetch() — wrap in Node HTTP server
    const server = createServer(async (req, res) => {
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v);
      }
      const body = await new Promise<string>((r) => {
        let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
      });
      const request = new Request(`http://127.0.0.1:5103${req.url}`, {
        method: req.method, headers,
        body: req.method !== "GET" ? body || undefined : undefined,
      });
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });

    ({ url, close } = await listen(server, 5103));

    const r1 = await post(`${url}/rpc/health`);
    expect(r1.status).toBe(200);
    expect(r1.data).toEqual({ status: "ok" });

    const r2 = await post(`${url}/rpc/echo`, { msg: "elysia" });
    expect(r2.status).toBe(200);
    expect(r2.data).toEqual({ echo: "elysia" });
  });
});

// ═══════════════════════════════════════════════════
//  NestJS (Express-based handler — test with real Express)
// ═══════════════════════════════════════════════════

describe("katmanNestHandler() — real Express server", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests like a NestJS controller", async () => {
    const express = (await import("express")).default;
    const { katmanNestHandler } = await import("../src/adapters/nestjs.ts");

    const rpcHandler = katmanNestHandler(testRouter, {
      context: (req: any) => ({ ip: req.ip }),
    });

    const app = express();
    app.use(express.json());
    // Express v5: {*name} for catch-all
    app.use("/rpc", (req: any, res: any) => {
      req.params = [req.path.slice(1)]; // strip leading /
      rpcHandler(req, res);
    });

    const server = app.listen(5104, "127.0.0.1");
    url = "http://127.0.0.1:5104";
    close = () => server.close();
    await new Promise(r => setTimeout(r, 100));

    const r1 = await post(`${url}/rpc/health`);
    expect(r1.status).toBe(200);
    expect(r1.data).toEqual({ status: "ok" });

    const r2 = await post(`${url}/rpc/echo`, { msg: "nestjs" });
    expect(r2.status).toBe(200);
    expect(r2.data).toEqual({ echo: "nestjs" });

    const r3 = await post(`${url}/rpc/fail`);
    expect(r3.status).toBe(404);
    expect(r3.data.code).toBe("NOT_FOUND");
  });
});

// ═══════════════════════════════════════════════════
//  Peer-to-peer (real MessageChannel)
// ═══════════════════════════════════════════════════

describe("createPeer() — bidirectional RPC", () => {
  it("two peers call each other's procedures", async () => {
    const { createPeer } = await import("../src/adapters/peer.ts");

    const routerA = k.router({
      ping: k.query(() => ({ from: "A", msg: "pong" })),
    });

    const routerB = k.router({
      hello: k.query(() => ({ from: "B", msg: "world" })),
    });

    const channel = new MessageChannel();

    const peerA = createPeer(routerA, channel.port1);
    const peerB = createPeer(routerB, channel.port2);

    // Peer A calls Peer B
    const fromB = await (peerA.client as any).hello();
    expect(fromB).toEqual({ from: "B", msg: "world" });

    // Peer B calls Peer A
    const fromA = await (peerB.client as any).ping();
    expect(fromA).toEqual({ from: "A", msg: "pong" });

    peerA.dispose();
    peerB.dispose();
    channel.port1.close();
    channel.port2.close();
  });
});

// ═══════════════════════════════════════════════════
//  Katman handler() — baseline (Nitro direct mode uses this)
// ═══════════════════════════════════════════════════

describe("handler() — Fetch API baseline", () => {
  it("handles all operations", async () => {
    const handle = k.handler(testRouter);

    const r1 = await handle(new Request("http://localhost/health", { method: "POST" }));
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });

    const r2 = await handle(new Request("http://localhost/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ msg: "handler" }),
    }));
    expect(await r2.json()).toEqual({ echo: "handler" });

    const r3 = await handle(new Request("http://localhost/fail", { method: "POST" }));
    expect(r3.status).toBe(404);
  });
});
