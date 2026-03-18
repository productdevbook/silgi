/**
 * Katman Playground — Server
 *
 * Run: pnpm play
 */

import { katman } from "../src/index.ts";
import { KatmanError } from "../src/core/error.ts";
import { z } from "zod";

// ── Schemas ──────────────────────────────────────────

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
});

// ── In-memory DB ─────────────────────────────────────

const db = {
  users: [
    { id: 1, name: "Alice", email: "alice@katman.dev" },
    { id: 2, name: "Bob", email: "bob@katman.dev" },
    { id: 3, name: "Charlie", email: "charlie@katman.dev" },
  ],
  nextId: 4,
};

// ── Katman Instance ──────────────────────────────────

const k = katman({
  context: (req: Request) => ({
    headers: Object.fromEntries(req.headers) as Record<string, string>,
    db,
  }),
});

// Destructure — use anywhere
const { query, mutation, subscription, guard, wrap, router, handler } = k;

// ── Middleware ────────────────────────────────────────

const auth = guard(async (ctx) => {
  const token = ctx.headers.authorization?.replace("Bearer ", "");
  if (token !== "secret-token") {
    throw new KatmanError("UNAUTHORIZED", { message: "Invalid token" });
  }
  return { userId: 1, role: "admin" as const };
});

const timing = wrap(async (ctx, next) => {
  const t0 = performance.now();
  const result = await next();
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`  [${ms}ms] ${JSON.stringify(result).slice(0, 80)}`);
  return result;
});

// ── Procedures ───────────────────────────────────────

// Kısa form — 0 config overhead
const health = query(async () => ({
  status: "ok",
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}));

// Kısa form — input + resolve
const listUsers = query(
  z.object({ limit: z.number().min(1).max(100).optional() }),
  async ({ input, ctx }) => {
    const limit = input.limit ?? 10;
    return {
      users: ctx.db.users.slice(0, limit),
      total: ctx.db.users.length,
    };
  },
);

// Kısa form — tek parametre ile
const getUser = query(
  z.object({ id: z.number() }),
  async ({ input, ctx }) => {
    const user = ctx.db.users.find((u) => u.id === input.id);
    if (!user) throw new KatmanError("NOT_FOUND", { message: `User #${input.id} not found` });
    return user;
  },
);

// Tam form — middleware + errors + validation
const createUser = mutation({
  use: [auth, timing],
  input: z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  }),
  output: UserSchema,
  errors: { CONFLICT: 409 },
  resolve: async ({ input, ctx, fail }) => {
    if (ctx.db.users.some((u) => u.email === input.email)) {
      fail("CONFLICT");
    }
    const user = { id: ctx.db.nextId++, ...input };
    ctx.db.users.push(user);
    console.log(`  [db] Created user #${user.id} by userId=${ctx.userId}`);
    return user;
  },
});

// Tam form — delete with auth
const deleteUser = mutation({
  use: [auth],
  input: z.object({ id: z.number() }),
  errors: { NOT_FOUND: 404 },
  resolve: async ({ input, ctx, fail }) => {
    const idx = ctx.db.users.findIndex((u) => u.id === input.id);
    if (idx === -1) fail("NOT_FOUND");
    ctx.db.users.splice(idx, 1);
    console.log(`  [db] Deleted user #${input.id}`);
    return { deleted: true };
  },
});

// Subscription — SSE streaming
const liveUpdates = subscription(async function* ({ ctx }) {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    yield { tick: i + 1, users: ctx.db.users.length, time: new Date().toISOString() };
  }
});

// ── Router ───────────────────────────────────────────

const appRouter = router({
  health,
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
    delete: deleteUser,
  },
  stream: {
    updates: liveUpdates,
  },
});

export type AppRouter = typeof appRouter;

// ── Serve ────────────────────────────────────────────

k.serve(appRouter, {
  port: 3456,
  scalar: {
    title: "Katman Playground API",
    version: "0.1.0",
    description: "Example API showcasing Katman v2 features",
  },
});

console.log("Routes:");
console.log("  /health              — Health check");
console.log("  /users/list          — List users");
console.log("  /users/get           — Get user by id");
console.log("  /users/create        — Create user (auth required)");
console.log("  /users/delete        — Delete user (auth required)");
console.log("  /stream/updates      — SSE stream (5 ticks)");
console.log("\nAuth: Bearer secret-token\n");
