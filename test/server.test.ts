import { describe, it, expect } from "vitest";
import { ks } from "../src/server/builder.ts";
import { isProcedure } from "../src/server/procedure.ts";
import { KatmanError } from "../src/core/error.ts";
import { createRouterClient } from "../src/server/router.ts";

describe("Builder (ks)", () => {
  it("creates a simple procedure with handler", () => {
    const proc = ks.handler(async () => "hello");
    expect(isProcedure(proc)).toBe(true);
    expect(proc["~katman"].middlewares).toHaveLength(0);
  });

  it("creates procedure with input/output schemas", async () => {
    const { z } = await import("zod");
    const proc = ks
      .input(z.object({ name: z.string() }))
      .output(z.object({ greeting: z.string() }))
      .handler(async ({ input }) => ({
        greeting: `Hello, ${input.name}!`,
      }));

    expect(isProcedure(proc)).toBe(true);
    expect(proc["~katman"].inputSchema).toBeDefined();
    expect(proc["~katman"].outputSchema).toBeDefined();
  });

  it("accumulates middlewares", () => {
    const mw1 = async (opts: any) => opts.next();
    const mw2 = async (opts: any) => opts.next();

    const proc = ks
      .use(mw1 as any)
      .use(mw2 as any)
      .handler(async () => "ok");

    expect(proc["~katman"].middlewares).toHaveLength(2);
  });

  it("sets validation index at middleware count when input() is called", () => {
    const mw = async (opts: any) => opts.next();
    const proc = ks
      .use(mw as any)
      .use(mw as any)
      .input({ "~standard": { version: 1, vendor: "test", validate: (v: any) => ({ value: v }) } } as any)
      .handler(async ({ input }) => input);

    expect(proc["~katman"].inputValidationIndex).toBe(2);
  });

  it("merges error maps", () => {
    const proc = ks
      .errors({ CONFLICT: { status: 409 } })
      .errors({ GONE: { status: 410 } })
      .handler(async () => "ok");

    expect(proc["~katman"].errorMap).toHaveProperty("CONFLICT");
    expect(proc["~katman"].errorMap).toHaveProperty("GONE");
  });

  it("sets route metadata", () => {
    const proc = ks
      .route({ method: "POST", path: "/users" })
      .handler(async () => "ok");

    expect(proc["~katman"].route.method).toBe("POST");
    expect(proc["~katman"].route.path).toBe("/users");
  });

  it("$context resets type", () => {
    const builder = ks.$context<{ userId: string }>();
    const proc = builder.handler(async ({ context }) => {
      return (context as { userId: string }).userId;
    });
    expect(isProcedure(proc)).toBe(true);
    expect(proc["~katman"].middlewares).toHaveLength(0);
  });
});

describe("Router", () => {
  it("creates a nested router", () => {
    const listUsers = ks.handler(async () => [{ id: 1, name: "Alice" }]);
    const getUser = ks.handler(async ({ input }) => ({ id: 1, name: "Alice" }));

    const router = {
      users: {
        list: listUsers,
        get: getUser,
      },
    };

    expect(isProcedure(router.users.list)).toBe(true);
    expect(isProcedure(router.users.get)).toBe(true);
  });

  it("enhances router with prefix and middlewares", async () => {
    const authMw = async (opts: any) => {
      return opts.next({ context: { user: "admin" } });
    };

    const listProc = ks.handler(async () => ["item1"]);

    const router = ks
      .use(authMw as any)
      .router({
        items: { list: listProc },
      });

    const enhanced = (router as any).items.list;
    expect(isProcedure(enhanced)).toBe(true);
    // The enhanced procedure should have the auth middleware prepended
    expect(enhanced["~katman"].middlewares.length).toBeGreaterThanOrEqual(1);
  });
});

describe("createRouterClient", () => {
  it("calls procedure through client proxy", async () => {
    const proc = ks.handler(async ({ input }) => `Hello, ${input}!`);
    const router = { greet: proc };

    const client = createRouterClient(router as any, { context: {} });
    const result = await (client as any).greet("World");
    expect(result).toBe("Hello, World!");
  });

  it("handles nested router paths", async () => {
    const listUsers = ks.handler(async () => [{ id: 1, name: "Alice" }]);
    const router = { users: { list: listUsers } };

    const client = createRouterClient(router as any, { context: {} });
    const result = await (client as any).users.list();
    expect(result).toEqual([{ id: 1, name: "Alice" }]);
  });
});

describe("Error handling in procedures", () => {
  it("throws KatmanError from handler", async () => {
    const proc = ks.handler(async () => {
      throw new KatmanError("NOT_FOUND", { message: "User not found" });
    });
    const router = { find: proc };
    const client = createRouterClient(router as any, { context: {} });

    await expect((client as any).find()).rejects.toThrow(KatmanError);
    await expect((client as any).find()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
