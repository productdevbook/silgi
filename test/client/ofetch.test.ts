/**
 * ofetch client link — integration tests.
 *
 * Spins up a real katman server and tests the ofetch-based client.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { z } from "zod";
import { katman } from "#src/katman.ts";
import { createClient } from "#src/client/client.ts";
import { createLink } from "#src/client/adapters/ofetch/index.ts";
import type { InferClient } from "#src/types.ts";
import { createServer, type Server } from "node:http";

// ── Server Setup ────────────────────────────────────

const k = katman({
  context: () => ({
    db: {
      users: [
        { id: 1, name: "Alice" },
        { id: 2, name: "Bob" },
      ],
    },
  }),
});

const { query, mutation, guard, router } = k;

const auth = guard(() => ({ userId: 1 }));

const appRouter = router({
  health: query(() => ({ status: "ok", ts: Date.now() })),
  users: {
    list: query(
      z.object({ limit: z.number().optional() }),
      ({ input, ctx }) => {
        const limit = input.limit ?? 10;
        return ctx.db.users.slice(0, limit);
      },
    ),
    get: query(
      z.object({ id: z.number() }),
      ({ input, ctx }) => {
        const user = ctx.db.users.find((u) => u.id === input.id);
        if (!user) throw new Error("Not found");
        return user;
      },
    ),
    create: mutation({
      use: [auth],
      input: z.object({ name: z.string().min(1) }),
      errors: { CONFLICT: 409 },
      resolve: ({ input }) => ({ id: 3, name: input.name }),
    }),
  },
  echo: query(
    z.object({ message: z.string() }),
    ({ input }) => ({ echo: input.message }),
  ),
});

type AppRouter = typeof appRouter;

// Use Fetch handler for testing (avoids port management)
const handle = k.handler(appRouter);

// Spin up a real HTTP server for ofetch tests
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    // Convert Node req/res to Fetch Request/Response
    const url = `http://localhost${req.url}`;
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0]! : value);
    }

    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      body = await new Promise<string>((resolve) => {
        let data = "";
        req.on("data", (chunk: Buffer) => { data += chunk; });
        req.on("end", () => resolve(data));
      });
    }

    const fetchReq = new Request(url, {
      method: req.method,
      headers,
      body: body || undefined,
    });

    const fetchRes = await handle(fetchReq);
    res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers));
    const resBody = await fetchRes.text();
    res.end(resBody);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
});

afterAll(() => {
  server?.close();
});

// ── Tests ───────────────────────────────────────────

describe("ofetch client link", () => {
  it("creates a typed client and calls a no-input query", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link);

    const result = await client.health();
    expect(result.status).toBe("ok");
    expect(typeof result.ts).toBe("number");
  });

  it("calls a query with input", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link);

    const result = await client.echo({ message: "hello" });
    expect(result.echo).toBe("hello");
  });

  it("calls nested procedures", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link);

    const users = await client.users.list({ limit: 1 });
    expect(users).toHaveLength(1);
    expect(users[0]!.name).toBe("Alice");
  });

  it("calls mutation with input", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link);

    const user = await client.users.create({ name: "Charlie" });
    expect(user.id).toBe(3);
    expect(user.name).toBe("Charlie");
  });

  it("handles validation errors", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link);

    await expect(
      client.users.create({ name: "" }),
    ).rejects.toThrow();
  });

  it("handles 404 for unknown routes", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link as any);

    await expect(
      (client as any).nonexistent(),
    ).rejects.toThrow();
  });

  it("supports custom headers", async () => {
    const link = createLink({
      url: baseUrl,
      headers: { "x-custom": "test-value" },
    });
    const client = createClient<InferClient<AppRouter>>(link);

    // Should work fine — headers don't break anything
    const result = await client.health();
    expect(result.status).toBe("ok");
  });

  it("supports dynamic headers", async () => {
    let headersCalled = false;
    const link = createLink({
      url: baseUrl,
      headers: () => {
        headersCalled = true;
        return { authorization: "Bearer test" };
      },
    });
    const client = createClient<InferClient<AppRouter>>(link);

    await client.health();
    expect(headersCalled).toBe(true);
  });

  it("supports timeout", async () => {
    const link = createLink({
      url: baseUrl,
      timeout: 5000,
    });
    const client = createClient<InferClient<AppRouter>>(link);

    const result = await client.health();
    expect(result.status).toBe("ok");
  });

  it("supports AbortSignal", async () => {
    const link = createLink({ url: baseUrl });
    const client = createClient<InferClient<AppRouter>>(link);

    const controller = new AbortController();
    controller.abort();

    await expect(
      client.health(undefined, { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("supports onRequest interceptor", async () => {
    let intercepted = false;
    const link = createLink({
      url: baseUrl,
      onRequest: () => { intercepted = true; },
    });
    const client = createClient<InferClient<AppRouter>>(link);

    await client.health();
    expect(intercepted).toBe(true);
  });

  it("supports onResponse interceptor", async () => {
    let responseStatus = 0;
    const link = createLink({
      url: baseUrl,
      onResponse: ({ response }) => {
        if (response) responseStatus = response.status;
      },
    });
    const client = createClient<InferClient<AppRouter>>(link);

    await client.health();
    expect(responseStatus).toBe(200);
  });
});
