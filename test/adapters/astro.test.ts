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

describe("katmanAstro() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanAstro } = await import("#src/adapters/astro.ts");
    const handler = katmanAstro(testRouter, { prefix: "/api/rpc" });

    const r1 = await handler({
      request: new Request("http://localhost/api/rpc/health", { method: "POST" }),
      params: {},
    });
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ status: "ok" });
  });
});
