import { describe, it, expect } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { callable } from "#src/callable.ts";

const k = katman({ context: () => ({ db: "test" }) });

describe("callable()", () => {
  it("calls a procedure directly without HTTP", async () => {
    const proc = k.query(
      z.object({ limit: z.number() }),
      ({ input }) => ({ items: input.limit }),
    );

    const fn = callable(proc, { context: () => ({ db: "test" }) });
    const result = await fn({ limit: 5 });
    expect(result).toEqual({ items: 5 });
  });

  it("runs guards in callable", async () => {
    const auth = k.guard(() => ({ userId: 42 }));
    const proc = k.query({
      use: [auth],
      resolve: ({ ctx }) => ({ user: (ctx as any).userId }),
    });

    const fn = callable(proc, { context: () => ({}) });
    const result = await fn();
    expect(result).toEqual({ user: 42 });
  });
});
