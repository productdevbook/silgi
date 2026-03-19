import { describe, it, expect, afterAll } from "vitest";
import { z } from "zod";
import { katman, KatmanError } from "#src/katman.ts";
import { createServer, type Server } from "node:http";

const k = katman({ context: () => ({ db: "test" }) });

const testRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ hello: input.name })),
  fail: k.query(() => { throw new KatmanError("NOT_FOUND", { message: "nope" }); }),
});

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

describe("katmanElysia() — real Elysia", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests", async () => {
    const { Elysia } = await import("elysia");
    const { katmanElysia } = await import("#src/adapters/elysia.ts");

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
