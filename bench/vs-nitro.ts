/**
 * Benchmark: Katman serve() vs Katman { fetch } on Nitro vs Nitro+H3 native
 *
 * Compares:
 * 1. Katman serve() — raw Node.js HTTP, compiled pipeline
 * 2. Katman handler() — Fetch API handler (used by Nitro direct mode)
 * 3. H3 v2 native — Nitro's default framework
 *
 * Run: node --experimental-strip-types bench/vs-nitro.ts
 */

import { createServer, type Server } from "node:http";
import { z } from "zod";

const ITERATIONS = 3000;
const KATMAN_SERVE_PORT = 4300;
const KATMAN_FETCH_PORT = 4301;
const H3_PORT = 4302;

// ── Shared Schema ────────────────────────────────────

const ListInput = z.object({ limit: z.number().min(1).max(100).optional() });
const CreateInput = z.object({ name: z.string().min(1), email: z.string().email() });

const db = [
  { id: 1, name: "Alice", email: "alice@test.dev" },
  { id: 2, name: "Bob", email: "bob@test.dev" },
  { id: 3, name: "Charlie", email: "charlie@test.dev" },
];

// ═══════════════════════════════════════════════════
//  1. Katman serve() — raw Node.js HTTP
// ═══════════════════════════════════════════════════

import { katman } from "../src/katman.ts";
import { compileRouter, ContextPool } from "../src/compile.ts";

const k = katman({ context: () => ({ db }) });
const auth = k.guard(() => ({ userId: 1 }));

const katmanRouter = k.router({
  health: k.query(() => ({ status: "ok" })),
  "users/list": k.query(ListInput as any, ({ input }: any) => ({
    users: db.slice(0, input.limit ?? 10),
    total: db.length,
  })),
  "users/create": k.mutation({
    use: [auth],
    input: CreateInput as any,
    resolve: ({ input, ctx }: any) => ({ id: 99, ...input, by: ctx.userId }),
  }),
});

async function startKatmanServeServer(): Promise<Server> {
  const flat = compileRouter(katmanRouter);
  const pool = new ContextPool();
  const signal = new AbortController().signal;

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const rawUrl = req.url ?? "/";
      const qIdx = rawUrl.indexOf("?");
      const pathname = qIdx === -1 ? rawUrl.slice(1) : rawUrl.slice(1, qIdx);

      const route = flat.get(pathname);
      if (!route) { res.statusCode = 404; res.end(); return; }

      const ctx = pool.borrow();
      ctx.db = db;
      try {
        let rawInput: unknown;
        const cl = req.headers["content-length"];
        if (req.method !== "GET" && cl && cl !== "0") {
          const text: string = await new Promise((r) => {
            let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
          });
          if (text) rawInput = JSON.parse(text);
        } else if (req.method !== "GET") { req.resume(); }

        const output = await route.handler(ctx, rawInput, signal);
        const body = JSON.stringify(output);
        res.writeHead(200, { "content-type": "application/json", "content-length": body.length });
        res.end(body);
      } catch (e: any) {
        res.statusCode = e.status ?? 500;
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        pool.release(ctx);
      }
    });
    server.listen(KATMAN_SERVE_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ═══════════════════════════════════════════════════
//  2. Katman handler() — Fetch API (Nitro direct mode)
// ═══════════════════════════════════════════════════

async function startKatmanFetchServer(): Promise<Server> {
  const fetchHandler = k.handler(katmanRouter);

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      // Convert Node request to Fetch Request (same as Nitro does)
      const url = `http://127.0.0.1:${KATMAN_FETCH_PORT}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v);
      }
      const body = await new Promise<string>((r) => {
        let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
      });
      const request = new Request(url, {
        method: req.method, headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? body || undefined : undefined,
      });

      const response = await fetchHandler(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });
    server.listen(KATMAN_FETCH_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ═══════════════════════════════════════════════════
//  3. H3 v2 native — what Nitro uses by default
// ═══════════════════════════════════════════════════

import { H3 } from "h3";

async function startH3Server(): Promise<Server> {
  const app = new H3();

  app.all("/health", () => ({ status: "ok" }));

  app.all("/users/list", async (event: any) => {
    const body = await event.req.json().catch(() => ({}));
    const parsed = ListInput.parse(body);
    return { users: db.slice(0, parsed.limit ?? 10), total: db.length };
  });

  app.all("/users/create", async (event: any) => {
    const userId = 1; // simulated auth
    const body = await event.req.json();
    const parsed = CreateInput.parse(body);
    return { id: 99, ...parsed, by: userId };
  });

  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${H3_PORT}${req.url}`;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headers.set(k, Array.isArray(v) ? v[0]! : v);
      }
      const body = await new Promise<string>((r) => {
        let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
      });
      const request = new Request(url, {
        method: req.method, headers,
        body: req.method !== "GET" && req.method !== "HEAD" ? body || undefined : undefined,
      });
      const response = await app.fetch(request);
      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      res.end(await response.text());
    });
    server.listen(H3_PORT, "127.0.0.1", () => resolve(server));
  });
}

// ═══════════════════════════════════════════════════
//  Benchmark Runner
// ═══════════════════════════════════════════════════

async function bench(
  url: string,
  body: string | null,
  n: number,
): Promise<{ avg: number; rps: number; p50: number; p99: number }> {
  const opts: RequestInit = { method: "POST" };
  if (body) { opts.headers = { "content-type": "application/json" }; opts.body = body; }

  // Warmup
  for (let i = 0; i < 200; i++) await (await fetch(url, opts)).text();

  const times: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await (await fetch(url, opts)).text();
    times.push(performance.now() - s);
  }
  const total = performance.now() - t0;
  times.sort((a, b) => a - b);

  return {
    avg: times.reduce((a, b) => a + b) / n,
    rps: Math.round((n / total) * 1000),
    p50: times[Math.floor(n * 0.5)]!,
    p99: times[Math.floor(n * 0.99)]!,
  };
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`;
}

function ratio(a: number, b: number): string {
  const r = b / a;
  return r >= 1 ? `${r.toFixed(1)}x faster` : `${(1 / r).toFixed(1)}x slower`;
}

// ═══════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════

async function main() {
  console.log("Starting servers...");
  const [serveSrv, fetchSrv, h3Srv] = await Promise.all([
    startKatmanServeServer(),
    startKatmanFetchServer(),
    startH3Server(),
  ]);
  console.log("All servers ready.\n");
  console.log(`Katman vs Nitro/H3 Benchmark — ${ITERATIONS} sequential requests | Node ${process.version}\n`);

  const scenarios = [
    { name: "Health (no mw, no validation)", path: "health", body: null },
    { name: "List (Zod validation)", path: "users/list", body: JSON.stringify({ limit: 2 }) },
    { name: "Create (guard + Zod)", path: "users/create", body: JSON.stringify({ name: "Eve", email: "eve@test.dev" }) },
  ];

  const results: Array<{
    name: string;
    serve: { avg: number; rps: number; p50: number; p99: number };
    fetch: { avg: number; rps: number; p50: number; p99: number };
    h3: { avg: number; rps: number; p50: number; p99: number };
  }> = [];

  for (const s of scenarios) {
    const serve = await bench(`http://127.0.0.1:${KATMAN_SERVE_PORT}/${s.path}`, s.body, ITERATIONS);
    const fetchR = await bench(`http://127.0.0.1:${KATMAN_FETCH_PORT}/${s.path}`, s.body, ITERATIONS);
    const h3 = await bench(`http://127.0.0.1:${H3_PORT}/${s.path}`, s.body, ITERATIONS);
    results.push({ name: s.name, serve, fetch: fetchR, h3 });
  }

  // Print table
  console.log("┌──────────────────────────────┬────────────────────┬────────────────────┬────────────────────┐");
  console.log("│ Scenario                     │  Katman serve()    │  Katman handler()  │  H3 v2 native      │");
  console.log("├──────────────────────────────┼────────────────────┼────────────────────┼────────────────────┤");
  for (const r of results) {
    const sStr = `${fmt(r.serve.avg).padStart(6)} ${String(r.serve.rps).padStart(5)}/s`;
    const fStr = `${fmt(r.fetch.avg).padStart(6)} ${String(r.fetch.rps).padStart(5)}/s`;
    const hStr = `${fmt(r.h3.avg).padStart(6)} ${String(r.h3.rps).padStart(5)}/s`;
    console.log(`│ ${r.name.padEnd(28)} │ ${sStr.padEnd(18)} │ ${fStr.padEnd(18)} │ ${hStr.padEnd(18)} │`);
  }
  console.log("└──────────────────────────────┴────────────────────┴────────────────────┴────────────────────┘");

  // Summary
  console.log("\nDetailed comparison:");
  for (const r of results) {
    console.log(`\n  ${r.name}:`);
    console.log(`    Katman serve()   : avg ${fmt(r.serve.avg)} | p50 ${fmt(r.serve.p50)} | p99 ${fmt(r.serve.p99)} | ${r.serve.rps} req/s`);
    console.log(`    Katman handler() : avg ${fmt(r.fetch.avg)} | p50 ${fmt(r.fetch.p50)} | p99 ${fmt(r.fetch.p99)} | ${r.fetch.rps} req/s`);
    console.log(`    H3 v2 native     : avg ${fmt(r.h3.avg)} | p50 ${fmt(r.h3.p50)} | p99 ${fmt(r.h3.p99)} | ${r.h3.rps} req/s`);
    console.log(`    → serve() vs H3: ${ratio(r.serve.avg, r.h3.avg)}`);
    console.log(`    → handler() vs H3: ${ratio(r.fetch.avg, r.h3.avg)}`);
  }

  serveSrv.close(); fetchSrv.close(); h3Srv.close();
}

main().catch(console.error);
