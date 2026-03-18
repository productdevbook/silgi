/**
 * Fastify adapter tests.
 *
 * Tests katmanFastify plugin registration and RPC execution.
 * Note: Uses a minimal Fastify mock since fastify is not a dependency.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { katman } from "../src/katman.ts";
import { katmanFastify } from "../src/adapters/fastify.ts";

const k = katman({ context: () => ({}) });
const appRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
});

// Minimal Fastify mock
function createMockFastify() {
  const routes: { method: string; path: string; handler: Function }[] = [];

  return {
    routes,
    all(path: string, handler: Function) {
      routes.push({ method: "ALL", path, handler });
    },
    async simulateRequest(url: string, body?: unknown) {
      const route = routes[0]; // catch-all
      if (!route) throw new Error("No route registered");

      let replyStatus = 200;
      let replyHeaders: Record<string, string> = {};
      let replyBody: unknown;

      const req = {
        url,
        method: "POST",
        headers: { "content-type": body ? "application/json" : "" },
        body,
      };

      const reply = {
        status(code: number) { replyStatus = code; return reply; },
        header(k: string, v: string) { replyHeaders[k] = v; return reply; },
        send(data: unknown) { replyBody = data; return reply; },
      };

      await route.handler(req, reply);
      return { status: replyStatus, headers: replyHeaders, body: replyBody };
    },
  };
}

describe("katmanFastify", () => {
  it("registers a catch-all route", async () => {
    const fastify = createMockFastify();
    const plugin = katmanFastify(appRouter);
    await plugin(fastify);

    expect(fastify.routes).toHaveLength(1);
    expect(fastify.routes[0]!.path).toBe("/*");
  });

  it("handles health query", async () => {
    const fastify = createMockFastify();
    await katmanFastify(appRouter)(fastify);

    const res = await fastify.simulateRequest("/health");
    expect(typeof res.body).toBe("string");
    const data = JSON.parse(res.body as string);
    expect(data.status).toBe("ok");
  });

  it("handles query with input", async () => {
    const fastify = createMockFastify();
    await katmanFastify(appRouter)(fastify);

    const res = await fastify.simulateRequest("/echo", { msg: "fastify" });
    const data = JSON.parse(res.body as string);
    expect(data.echo).toBe("fastify");
  });

  it("returns 404 for unknown routes", async () => {
    const fastify = createMockFastify();
    await katmanFastify(appRouter)(fastify);

    const res = await fastify.simulateRequest("/unknown");
    expect(res.status).toBe(404);
  });

  it("supports prefix option", async () => {
    const fastify = createMockFastify();
    await katmanFastify(appRouter, { prefix: "/rpc" })(fastify);

    expect(fastify.routes[0]!.path).toBe("/rpc/*");
  });

  it("supports context factory", async () => {
    const fastify = createMockFastify();
    await katmanFastify(appRouter, {
      context: (req) => ({ fromFastify: true }),
    })(fastify);

    const res = await fastify.simulateRequest("/health");
    const data = JSON.parse(res.body as string);
    expect(data.status).toBe("ok");
  });
});
