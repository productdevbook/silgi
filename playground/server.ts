/**
 * Katman Playground — Server
 *
 * Run: node --experimental-strip-types playground/server.ts
 */

import { createServer } from "node:http";
import { ks, KatmanError, type Context } from "../src/index.ts";
import { RPCHandler } from "../src/server/adapters/node/index.ts";
import { CORSPlugin } from "../src/server/plugins/cors.ts";
import { z } from "zod";

// ── Schemas ──────────────────────────────────────────

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  createdAt: z.date(),
});

type User = z.infer<typeof UserSchema>;

// ── In-memory DB ─────────────────────────────────────

const db: User[] = [
  { id: 1, name: "Alice", email: "alice@katman.dev", createdAt: new Date("2024-01-15") },
  { id: 2, name: "Bob", email: "bob@katman.dev", createdAt: new Date("2024-03-22") },
  { id: 3, name: "Charlie", email: "charlie@katman.dev", createdAt: new Date("2024-06-10") },
];

let nextId = 4;

// ── Auth Middleware ──────────────────────────────────

const withAuth = ks
  .$context<{ headers: Record<string, string | string[] | undefined> }>()
  .use(async ({ context, next, errors }) => {
    const auth = context.headers["authorization"];
    const token = typeof auth === "string" ? auth.replace("Bearer ", "") : undefined;

    if (!token || token !== "secret-token") {
      throw new KatmanError("UNAUTHORIZED", { message: "Invalid or missing token" });
    }

    return next({ context: { userId: 1, role: "admin" as const } });
  });

// ── Procedures ──────────────────────────────────────

const listUsers = ks
  .input(z.object({
    limit: z.number().min(1).max(100).optional(),
    offset: z.number().min(0).optional(),
  }))
  .handler(async ({ input }) => {
    const limit = input.limit ?? 10;
    const offset = input.offset ?? 0;
    return {
      users: db.slice(offset, offset + limit),
      total: db.length,
    };
  });

const getUser = ks
  .input(z.object({ id: z.number() }))
  .output(UserSchema)
  .handler(async ({ input }) => {
    const user = db.find((u) => u.id === input.id);
    if (!user) {
      throw new KatmanError("NOT_FOUND", { message: `User #${input.id} not found` });
    }
    return user;
  });

const createUser = withAuth
  .input(z.object({
    name: z.string().min(1).max(100),
    email: z.string().email(),
  }))
  .errors({
    CONFLICT: { status: 409, message: "Email already taken" },
  })
  .handler(async ({ input, context, errors }) => {
    if (db.some((u) => u.email === input.email)) {
      throw errors.CONFLICT({ data: { email: input.email } });
    }
    const user: User = { id: nextId++, ...input, createdAt: new Date() };
    db.push(user);
    console.log(`  [db] Created user #${user.id} by userId=${context.userId}`);
    return user;
  });

const deleteUser = withAuth
  .input(z.object({ id: z.number() }))
  .handler(async ({ input, context }) => {
    const idx = db.findIndex((u) => u.id === input.id);
    if (idx === -1) {
      throw new KatmanError("NOT_FOUND", { message: `User #${input.id} not found` });
    }
    db.splice(idx, 1);
    console.log(`  [db] Deleted user #${input.id} by userId=${context.userId}`);
    return { deleted: true };
  });

// ── SSE Streaming ───────────────────────────────────

const streamUpdates = ks.handler(async function* () {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 500));
    yield { tick: i + 1, timestamp: new Date().toISOString(), users: db.length };
  }
});

// ── Health ──────────────────────────────────────────

const health = ks
  .route({ method: "GET", path: "/health" })
  .handler(async () => ({
    status: "ok",
    uptime: process.uptime(),
    timestamp: new Date(),
  }));

// ── Router ──────────────────────────────────────────

const router = {
  health,
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
    delete: deleteUser,
  },
  stream: {
    updates: streamUpdates,
  },
};

export type AppRouter = typeof router;

// ── HTTP Server ─────────────────────────────────────

const handler = new RPCHandler(router, {
  plugins: [new CORSPlugin()],
});

const server = createServer(async (req, res) => {
  const result = await handler.handle(req, res, {
    context: { headers: req.headers },
  });

  if (!result.matched) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: "Not found" }));
  }
});

const PORT = 3456;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n🚀 Katman playground server running at http://127.0.0.1:${PORT}\n`);
  console.log("Routes:");
  console.log("  POST /health         — Health check");
  console.log("  POST /users/list     — List users");
  console.log("  POST /users/get      — Get user by id");
  console.log("  POST /users/create   — Create user (requires auth)");
  console.log("  POST /users/delete   — Delete user (requires auth)");
  console.log("  POST /stream/updates — SSE stream (5 ticks)");
  console.log("\nAuth token: Bearer secret-token\n");
});
