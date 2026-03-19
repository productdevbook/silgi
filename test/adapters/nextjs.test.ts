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

describe("katmanNextjs() — real Request/Response", () => {
  it("handles real Fetch API requests", async () => {
    const { katmanNextjs } = await import("#src/adapters/nextjs.ts");
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
