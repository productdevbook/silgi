/**
 * React Server Actions v2 — integration tests.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { katman } from "../src/katman.ts";
import { createAction, createActions, createFormAction } from "../src/integrations/react/v2.ts";

const k = katman({ context: () => ({}) });

const appRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  users: {
    create: k.mutation(
      z.object({ name: z.string().min(1) }),
      ({ input }) => ({ id: 1, name: input.name }),
    ),
  },
});

describe("createAction", () => {
  it("returns [null, data] on success", async () => {
    const action = createAction(appRouter.health);
    const [error, data] = await action(undefined);
    expect(error).toBeNull();
    expect(data).toEqual({ status: "ok" });
  });

  it("passes input to the procedure", async () => {
    const action = createAction(appRouter.echo);
    const [error, data] = await action({ msg: "hello" });
    expect(error).toBeNull();
    expect((data as any).echo).toBe("hello");
  });

  it("returns [error, undefined] on validation failure", async () => {
    const action = createAction(appRouter.users.create);
    const [error, data] = await action({ name: "" }); // min(1) fails
    expect(error).toBeTruthy();
    expect(data).toBeUndefined();
  });
});

describe("createActions", () => {
  it("creates nested action router", async () => {
    const actions = createActions(appRouter);

    const [e1, d1] = await actions.health(undefined as any);
    expect(e1).toBeNull();
    expect((d1 as any).status).toBe("ok");

    const [e2, d2] = await (actions.users as any).create({ name: "Alice" });
    expect(e2).toBeNull();
    expect((d2 as any).name).toBe("Alice");
  });
});

describe("createFormAction", () => {
  it("parses FormData and calls procedure", async () => {
    const action = createFormAction(appRouter.users.create);
    const fd = new FormData();
    fd.set("name", "Bob");
    const [error, data] = await action(fd);
    expect(error).toBeNull();
    expect((data as any).name).toBe("Bob");
  });
});
