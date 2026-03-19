import { describe, it, expect, afterAll } from "vitest";
import { z } from "zod";
import { katman, KatmanError } from "#src/katman.ts";

const k = katman({ context: () => ({ db: "test" }) });

const testRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ hello: input.name })),
  fail: k.query(() => { throw new KatmanError("NOT_FOUND", { message: "nope" }); }),
});

async function post(url: string, body?: unknown): Promise<{ status: number; data: any }> {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json() };
}

describe("katmanNestHandler() — real Express server", () => {
  let url: string;
  let close: () => void;

  afterAll(() => close?.());

  it("starts and handles requests like a NestJS controller", async () => {
    const express = (await import("express")).default;
    const { katmanNestHandler } = await import("#src/adapters/nestjs.ts");

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
