import { describe, it, expect } from "vitest";
import { z } from "zod";
import { kc } from "../src/contract/builder.ts";
import { implement } from "../src/server/implementer.ts";
import { isProcedure } from "../src/server/procedure.ts";
import { createRouterClient } from "../src/server/router.ts";

describe("implement() — Contract-First Pattern", () => {
  const contract = {
    users: {
      list: kc
        .route({ method: "GET", path: "/users" })
        .input(z.object({ limit: z.number().optional() })),
      get: kc
        .route({ method: "GET", path: "/users/{id}" })
        .input(z.object({ id: z.number() })),
      create: kc
        .route({ method: "POST", path: "/users" })
        .input(z.object({ name: z.string(), email: z.string() }))
        .errors({ CONFLICT: { status: 409 } }),
    },
  };

  it("creates an implementer from a contract", () => {
    const server = implement(contract);
    expect(server).toBeDefined();
    expect(typeof server.use).toBe("function");
    expect(typeof server.router).toBe("function");
  });

  it("builds procedure handlers from contract", () => {
    const server = implement(contract);

    const router = server.router({
      users: {
        list: (server as any).users.list.handler(async ({ input }: any) => {
          return [{ id: 1, name: "Alice" }];
        }),
        get: (server as any).users.get.handler(async ({ input }: any) => {
          return { id: input.id, name: "Alice" };
        }),
        create: (server as any).users.create.handler(async ({ input }: any) => {
          return { id: 1, ...input };
        }),
      },
    });

    expect(isProcedure(router.users.list)).toBe(true);
    expect(isProcedure(router.users.get)).toBe(true);
    expect(isProcedure(router.users.create)).toBe(true);
  });

  it("preserves contract schemas on implemented procedures", () => {
    const server = implement(contract);

    const proc = (server as any).users.list.handler(async () => []);
    expect(proc["~katman"].inputSchema).toBeDefined();
    expect(proc["~katman"].route.method).toBe("GET");
    expect(proc["~katman"].route.path).toBe("/users");
  });

  it("preserves contract error maps", () => {
    const server = implement(contract);

    const proc = (server as any).users.create.handler(async () => ({}));
    expect(proc["~katman"].errorMap).toHaveProperty("CONFLICT");
  });

  it("executes implemented procedures through router client", async () => {
    const server = implement(contract);

    const router = server.router({
      users: {
        list: (server as any).users.list.handler(
          async ({ input }: any) => {
            const limit = input?.limit ?? 10;
            return Array.from({ length: limit }, (_, i) => ({
              id: i + 1,
              name: `User ${i + 1}`,
            }));
          },
        ),
        get: (server as any).users.get.handler(
          async ({ input }: any) => ({ id: input.id, name: "Alice", email: "a@b.com" }),
        ),
        create: (server as any).users.create.handler(
          async ({ input }: any) => ({ id: 1, ...input }),
        ),
      },
    });

    const client = createRouterClient(router as any, { context: {} });

    const users = await (client as any).users.list({ limit: 3 });
    expect(users).toHaveLength(3);

    const user = await (client as any).users.get({ id: 42 });
    expect(user.id).toBe(42);
    expect(user.name).toBe("Alice");
  });

  it("applies shared middleware to all procedures", async () => {
    const server = implement(contract);

    const authedServer = server.use(async (opts: any) => {
      return opts.next({ context: { userId: "admin" } });
    });

    const router = authedServer.router({
      users: {
        list: (authedServer as any).users.list.handler(
          async ({ context }: any) => [{ id: 1, name: context.userId }],
        ),
        get: (authedServer as any).users.get.handler(
          async ({ context, input }: any) => ({
            id: input.id,
            name: context.userId,
          }),
        ),
        create: (authedServer as any).users.create.handler(
          async ({ context, input }: any) => ({
            id: 1,
            name: context.userId,
            ...input,
          }),
        ),
      },
    });

    const client = createRouterClient(router as any, { context: {} });
    const users = await (client as any).users.list({});
    expect(users[0].name).toBe("admin");
  });
});
