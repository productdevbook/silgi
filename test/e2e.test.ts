/**
 * End-to-end integration tests — full server→client flow.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ks } from "../src/server/builder.ts";
import { kc } from "../src/contract/builder.ts";
import { KatmanError } from "../src/core/error.ts";
import { createRouterClient } from "../src/server/router.ts";

// === Full CRUD API ===
describe("E2E: Full CRUD API", () => {
  // Define schemas
  const UserSchema = z.object({
    id: z.number(),
    name: z.string(),
    email: z.string().email(),
  });

  // In-memory store
  const users = [
    { id: 1, name: "Alice", email: "alice@example.com" },
    { id: 2, name: "Bob", email: "bob@example.com" },
  ];

  // Define procedures
  const listUsers = ks
    .input(z.object({ limit: z.number().optional() }))
    .handler(async ({ input }) => {
      const limit = input.limit ?? 10;
      return users.slice(0, limit);
    });

  const getUser = ks
    .input(z.object({ id: z.number() }))
    .output(UserSchema)
    .handler(async ({ input }) => {
      const user = users.find((u) => u.id === input.id);
      if (!user) throw new KatmanError("NOT_FOUND", { message: "User not found" });
      return user;
    });

  const createUser = ks
    .input(z.object({ name: z.string(), email: z.string().email() }))
    .output(UserSchema)
    .handler(async ({ input }) => {
      const newUser = { id: users.length + 1, ...input };
      users.push(newUser);
      return newUser;
    });

  const router = {
    users: {
      list: listUsers,
      get: getUser,
      create: createUser,
    },
  };

  const client = createRouterClient(router as any, { context: {} });

  it("lists users", async () => {
    const result = await (client as any).users.list({ limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Alice");
  });

  it("gets a user by id", async () => {
    const result = await (client as any).users.get({ id: 2 });
    expect(result.name).toBe("Bob");
    expect(result.email).toBe("bob@example.com");
  });

  it("creates a user", async () => {
    const result = await (client as any).users.create({
      name: "Charlie",
      email: "charlie@example.com",
    });
    expect(result.id).toBe(3);
    expect(result.name).toBe("Charlie");
  });

  it("throws NOT_FOUND for missing user", async () => {
    await expect((client as any).users.get({ id: 999 })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "User not found",
    });
  });

  it("validates input schema", async () => {
    await expect(
      (client as any).users.get({ id: "not-a-number" }),
    ).rejects.toThrow();
  });
});

// === Middleware Chain ===
describe("E2E: Middleware Chain", () => {
  it("executes middleware in correct order with context passing", async () => {
    const order: string[] = [];

    const authMiddleware = async (opts: any) => {
      order.push("auth");
      return opts.next({ context: { userId: "user-123" } });
    };

    const loggingMiddleware = async (opts: any) => {
      order.push("log-before");
      const result = await opts.next();
      order.push("log-after");
      return result;
    };

    const proc = ks
      .use(authMiddleware as any)
      .use(loggingMiddleware as any)
      .handler(async ({ context }) => {
        order.push("handler");
        return { userId: (context as any).userId };
      });

    const client = createRouterClient({ test: proc } as any, { context: {} });
    const result = await (client as any).test();

    expect(result.userId).toBe("user-123");
    expect(order).toEqual(["auth", "log-before", "handler", "log-after"]);
  });
});

// === Error Maps ===
describe("E2E: Typed Errors", () => {
  it("throws typed errors with data", async () => {
    const proc = ks
      .errors({
        DUPLICATE_EMAIL: {
          status: 409,
          message: "Email already exists",
        },
      })
      .input(z.object({ email: z.string() }))
      .handler(async ({ input, errors }) => {
        if (input.email === "taken@example.com") {
          throw (errors as any).DUPLICATE_EMAIL({ data: { email: input.email } });
        }
        return { ok: true };
      });

    const client = createRouterClient({ register: proc } as any, { context: {} });

    await expect(
      (client as any).register({ email: "taken@example.com" }),
    ).rejects.toMatchObject({
      code: "DUPLICATE_EMAIL",
      status: 409,
    });

    const result = await (client as any).register({ email: "new@example.com" });
    expect(result.ok).toBe(true);
  });
});

// === Router Enhancement ===
describe("E2E: Router Enhancement", () => {
  it("enhances router with shared middleware", async () => {
    const proc1 = ks.handler(async ({ context }) => ({
      auth: !!(context as any).authed,
    }));

    const proc2 = ks.handler(async ({ context }) => ({
      auth: !!(context as any).authed,
    }));

    const enhanced = ks
      .use(async (opts: any) => opts.next({ context: { authed: true } }) as any)
      .router({ a: proc1, b: proc2 });

    const client = createRouterClient(enhanced as any, { context: {} });

    const result1 = await (client as any).a();
    const result2 = await (client as any).b();

    expect(result1.auth).toBe(true);
    expect(result2.auth).toBe(true);
  });
});

// === Contract-First Pattern ===
describe("E2E: Contract Definition", () => {
  it("defines a full API contract", async () => {
    const contract = {
      planets: {
        list: kc
          .route({ method: "GET", path: "/planets" })
          .input(z.object({ limit: z.number().optional() })),
        create: kc
          .route({ method: "POST", path: "/planets" })
          .input(z.object({ name: z.string() }))
          .errors({ CONFLICT: { status: 409 } }),
      },
    };

    // Verify contract structure
    expect(contract.planets.list["~katman"].route.method).toBe("GET");
    expect(contract.planets.list["~katman"].route.path).toBe("/planets");
    expect(contract.planets.create["~katman"].errorMap).toHaveProperty("CONFLICT");
  });
});
