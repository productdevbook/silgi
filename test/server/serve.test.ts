/**
 * v2 serve() — HTTP integration tests.
 *
 * Tests the Node.js HTTP server created by katman().serve().
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { createServer, type Server } from "node:http";

// ── Setup ──────────────────────────────────────────

const db = {
  users: [
    { id: 1, name: "Alice", email: "alice@test.com" },
    { id: 2, name: "Bob", email: "bob@test.com" },
  ],
};

const k = katman({
  context: (req: Request) => ({
    headers: Object.fromEntries(req.headers) as Record<string, string>,
    db,
  }),
});

const { query, mutation, guard, router } = k;

const listUsers = query(
  z.object({ limit: z.number().min(1).max(100).optional() }),
  ({ input, ctx }) => {
    const limit = input.limit ?? 10;
    return { users: ctx.db.users.slice(0, limit), total: ctx.db.users.length };
  },
);

const getUser = query(
  z.object({ id: z.number() }),
  ({ input, ctx }) => {
    const user = ctx.db.users.find((u) => u.id === input.id);
    if (!user) throw new Error("Not found");
    return user;
  },
);

const createUser = mutation({
  input: z.object({ name: z.string().min(1), email: z.string().email() }),
  errors: { CONFLICT: 409 },
  resolve: ({ input, ctx }) => {
    const user = { id: ctx.db.users.length + 1, ...input };
    return user;
  },
});

const noInput = query(() => ({ status: "ok" }));

const appRouter = router({
  health: noInput,
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
  },
});

// Use handler() instead of serve() for testing (no port needed)
const handle = k.handler(appRouter);

// ── Helpers ────────────────────────────────────────

async function get(path: string) {
  const res = await handle(new Request(`http://localhost/${path}`));
  return { status: res.status, body: await res.json() };
}

async function post(path: string, body?: unknown) {
  const res = await handle(new Request(`http://localhost/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }));
  return { status: res.status, body: await res.json() };
}

// ── Tests ──────────────────────────────────────────

describe("v2 serve — HTTP handler", () => {
  it("no-input query returns result", async () => {
    const { status, body } = await get("health");
    expect(status).toBe(200);
    expect(body.status).toBe("ok");
  });

  it("query with POST body input", async () => {
    const { status, body } = await post("users/list", { limit: 1 });
    expect(status).toBe(200);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].name).toBe("Alice");
  });

  it("query with GET ?data= query param", async () => {
    const data = encodeURIComponent(JSON.stringify({ limit: 1 }));
    const { status, body } = await get(`users/list?data=${data}`);
    expect(status).toBe(200);
    expect(body.users).toHaveLength(1);
  });

  it("query with no input when input has all optional fields", async () => {
    // limit is optional, so calling without input should work (defaults to 10)
    const { status, body } = await post("users/list", {});
    expect(status).toBe(200);
    expect(body.total).toBe(2);
  });

  it("mutation with POST body", async () => {
    const { status, body } = await post("users/create", {
      name: "Charlie",
      email: "charlie@test.com",
    });
    expect(status).toBe(200);
    expect(body.name).toBe("Charlie");
    expect(body.email).toBe("charlie@test.com");
  });

  it("returns 404 for unknown route", async () => {
    const { status, body } = await get("unknown/route");
    expect(status).toBe(404);
    expect(body.code).toBe("NOT_FOUND");
  });

  it("returns validation error for invalid input", async () => {
    const { status, body } = await post("users/create", {
      name: "",       // min(1) fails
      email: "bad",   // email() fails
    });
    expect(status).toBe(400); // validation error
  });

  it("returns validation error when required fields are missing", async () => {
    const { status } = await post("users/get", {});
    expect(status).toBe(400);
  });

  it("GET without data param — optional input defaults work", async () => {
    // GET /users/list without any query params
    // input is z.object({ limit: z.number().optional() })
    // Should either pass {} or undefined — both should work with optional fields
    const res = await handle(new Request("http://localhost/users/list"));
    // This currently fails because undefined is not a valid z.object()
    // After fix: should pass {} to the validator
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(2);
  });
});
