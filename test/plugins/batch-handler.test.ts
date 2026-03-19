import { describe, it, expect } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { createBatchHandler } from "#src/plugins/batch-server.ts";

const k = katman({ context: () => ({ db: "test" }) });

describe("createBatchHandler()", () => {
  it("processes multiple calls in one request", async () => {
    const router = k.router({
      health: k.query(() => ({ status: "ok" })),
      echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
    });

    const handler = createBatchHandler(router, { context: () => ({}) });

    const request = new Request("http://localhost/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { path: "health" },
        { path: "echo", input: { msg: "hi" } },
        { path: "nonexistent" },
      ]),
    });

    const response = await handler(request);
    const results = await response.json();

    expect(results).toHaveLength(3);
    expect(results[0].data).toEqual({ status: "ok" });
    expect(results[1].data).toEqual({ echo: "hi" });
    expect(results[2].error.code).toBe("NOT_FOUND");
  });

  it("rejects oversized batches", async () => {
    const router = k.router({ health: k.query(() => "ok") });
    const handler = createBatchHandler(router, { context: () => ({}), maxBatchSize: 2 });

    const request = new Request("http://localhost/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([{ path: "a" }, { path: "b" }, { path: "c" }]),
    });

    const response = await handler(request);
    expect(response.status).toBe(400);
  });
});
