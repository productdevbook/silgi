import { describe, it, expect } from "vitest";
import { z } from "zod";
import { katman, KatmanError } from "#src/katman.ts";

const k = katman({ context: () => ({ db: "test" }) });

const testRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ hello: input.name })),
  fail: k.query(() => { throw new KatmanError("NOT_FOUND", { message: "nope" }); }),
});

describe("katmanNitro() — real NitroEvent", () => {
  it("handles FS routing with path param", async () => {
    const { katmanNitro } = await import("#src/adapters/nitro.ts");
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
    const { katmanNitro } = await import("#src/adapters/nitro.ts");
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
    const { katmanNitro } = await import("#src/adapters/nitro.ts");
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
    const { katmanNitro } = await import("#src/adapters/nitro.ts");
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
    const { katmanNitro } = await import("#src/adapters/nitro.ts");
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
    const { katmanNitro } = await import("#src/adapters/nitro.ts");
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
