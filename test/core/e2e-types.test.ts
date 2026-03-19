/**
 * E2E type safety test — full client → server roundtrip.
 */

import { describe, it, expect, expectTypeOf, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { createClient } from "#src/client/client.ts";
import { createLink } from "#src/client/adapters/ofetch/index.ts";
import type { InferClient } from "#src/types.ts";
import { createServer, type Server } from "node:http";

// ── Server ─────────────────────────────────────────

const k = katman({
  context: () => ({ db: { users: [{ id: 1, name: "Alice", email: "a@test.com" }] } }),
});

const auth = k.guard(() => ({ userId: 1 }));

const appRouter = k.router({
  health: k.query(() => ({ status: "ok" as const, uptime: 123 })),
  users: {
    list: k.query(
      z.object({ limit: z.number().optional() }),
      ({ input, ctx }) => ctx.db.users.slice(0, input.limit ?? 10),
    ),
    get: k.query(
      z.object({ id: z.number() }),
      ({ input, ctx }) => {
        const user = ctx.db.users.find((u) => u.id === input.id);
        if (!user) throw new Error("Not found");
        return user;
      },
    ),
    create: k.mutation({
      use: [auth],
      input: z.object({ name: z.string(), email: z.string().email() }),
      errors: { CONFLICT: 409 },
      resolve: ({ input, ctx }) => ({ id: 2, ...input }),
    }),
  },
});

type AppRouter = typeof appRouter;
type Client = InferClient<AppRouter>;

const handle = k.handler(appRouter);

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = `http://localhost${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0]! : value);
    }
    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await new Promise<string>((r) => { let d = ""; req.on("data", (c: Buffer) => d += c); req.on("end", () => r(d)); });
    }
    const fetchReq = new Request(url, { method: req.method, headers, body: body || undefined });
    const fetchRes = await handle(fetchReq);
    res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers));
    res.end(await fetchRes.text());
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => {
    baseUrl = `http://127.0.0.1:${(server.address() as any).port}`;
    r();
  }));
});

afterAll(() => server?.close());

// ── Type Tests ─────────────────────────────────────

describe("E2E type roundtrip", () => {
  it("InferClient produces correct types for no-input query", () => {
    expectTypeOf<Client["health"]>().toBeFunction();
    expectTypeOf<Client["health"]>().returns.resolves.toMatchTypeOf<{ status: "ok"; uptime: number }>();
  });

  it("InferClient produces correct types for input query", () => {
    expectTypeOf<Client["users"]["list"]>().toBeFunction();
    // Input is { limit?: number }
    expectTypeOf<Client["users"]["list"]>().parameter(0).toMatchTypeOf<{ limit?: number }>();
  });

  it("InferClient produces correct types for mutation", () => {
    expectTypeOf<Client["users"]["create"]>().toBeFunction();
    expectTypeOf<Client["users"]["create"]>().parameter(0).toMatchTypeOf<{ name: string; email: string }>();
  });

  it("full roundtrip: client → server → client", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<Client>(link);

    // No-input query
    const health = await client.health();
    expect(health.status).toBe("ok");

    // Input query
    const users = await client.users.list({ limit: 1 });
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Alice");

    // Get by id
    const user = await client.users.get({ id: 1 });
    expect(user.name).toBe("Alice");

    // Mutation
    const created = await client.users.create({ name: "Bob", email: "b@test.com" });
    expect(created.id).toBe(2);
    expect(created.name).toBe("Bob");
  });

  it("client handles errors", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<Client>(link);

    await expect(client.users.get({ id: 999 })).rejects.toThrow();
  });
});
