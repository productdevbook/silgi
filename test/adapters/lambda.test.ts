import { describe, it, expect } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { katmanLambda } from "#src/adapters/aws-lambda.ts";

const k = katman({ context: () => ({ db: "test" }) });

describe("katmanLambda()", () => {
  it("handles Lambda events", async () => {
    const router = k.router({
      health: k.query(() => ({ status: "ok" })),
      echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
    });

    const handler = katmanLambda(router, { context: () => ({}) });

    const result = await handler({
      httpMethod: "POST",
      path: "/echo",
      body: JSON.stringify({ msg: "hello" }),
      headers: { "content-type": "application/json" },
      queryStringParameters: null,
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ echo: "hello" });
  });

  it("returns 404 for unknown procedures", async () => {
    const router = k.router({ health: k.query(() => "ok") });
    const handler = katmanLambda(router, { context: () => ({}) });

    const result = await handler({
      httpMethod: "POST",
      path: "/unknown",
      body: null,
      headers: {},
      queryStringParameters: null,
    });

    expect(result.statusCode).toBe(404);
  });

  it("strips prefix", async () => {
    const router = k.router({ health: k.query(() => ({ ok: true })) });
    const handler = katmanLambda(router, { prefix: "/rpc", context: () => ({}) });

    const result = await handler({
      httpMethod: "POST",
      path: "/rpc/health",
      body: null,
      headers: {},
      queryStringParameters: null,
    });

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
  });
});
