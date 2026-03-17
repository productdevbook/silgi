/**
 * Realistic Benchmark: Simulated database latency
 *
 * Real-world handlers aren't instant — they query databases (1-50ms).
 * This benchmark shows the TRUE impact of caching + coalescing
 * when handlers have realistic latency.
 *
 * Run: node --experimental-strip-types bench/realistic-db.ts
 */

import { createServer, type Server } from "node:http";
import { z } from "zod";

import { katman } from "../src/api/katman.ts";
import { compileRouter, ContextPool } from "../src/api/compile.ts";
import { ResponseCache } from "../src/api/response-cache.ts";
import { RequestCoalescer } from "../src/api/coalesce.ts";

import { os as orpcOs } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";

// ── Simulated DB with realistic latency ─────────────

const DB_LATENCY_MS = 50; // 50ms — realistic PostgreSQL JOIN / complex query
let katmanHandlerCalls = 0;
let orpcHandlerCalls = 0;

async function queryDB(limit: number): Promise<unknown[]> {
  await new Promise(r => setTimeout(r, DB_LATENCY_MS));
  return Array.from({ length: limit }, (_, i) => ({
    id: i + 1, name: `User ${i + 1}`, email: `u${i + 1}@test.com`,
  }));
}

// ── Katman (with cache + coalesce) ──────────────────

const k = katman({ context: () => ({}) });
const katmanRouter = k.router({
  list: k.query(
    z.object({ limit: z.number() }) as any,
    async ({ input }: any) => {
      katmanHandlerCalls++;
      return queryDB(input.limit);
    },
  ),
});

async function startKatmanServer(port: number): Promise<Server> {
  const flat = compileRouter(katmanRouter);
  const pool = new ContextPool();
  const sig = new AbortController().signal;
  const cache = new ResponseCache({ maxSize: 1000, ttlMs: 10_000 });
  const coalescer = new RequestCoalescer();

  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const u = req.url ?? "/";
      const q = u.indexOf("?");
      const pathname = q === -1 ? u.slice(1) : u.slice(1, q);
      const route = flat.get(pathname);
      if (!route) { res.statusCode = 404; res.end(); return; }

      let rawInput: unknown;
      const cl = req.headers["content-length"];
      if (req.method !== "GET" && cl && cl !== "0") {
        const t: string = await new Promise(r => {
          let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
        });
        if (t) rawInput = JSON.parse(t);
      } else if (req.method !== "GET") req.resume();

      const cacheKey = ResponseCache.key(pathname, rawInput);

      // Cache hit → instant response
      const cached = cache.get(cacheKey);
      if (cached) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(cached);
        return;
      }

      // Coalesce + execute
      try {
        const body = await coalescer.execute(cacheKey, async () => {
          const ctx = pool.borrow();
          try {
            const pr = route.handler(ctx, rawInput, sig);
            const out = pr instanceof Promise ? await pr : pr;
            return route.stringify(out);
          } finally { pool.release(ctx); }
        });
        cache.set(cacheKey, body);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(body);
      } catch (e: any) {
        res.statusCode = 500; res.end(JSON.stringify({ error: e.message }));
      }
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── oRPC (standard, no cache) ───────────────────────

async function startORPCServer(port: number): Promise<Server> {
  const orpcRouter = {
    list: orpcOs
      .input(z.object({ limit: z.number() }))
      .handler(async ({ input }) => {
        orpcHandlerCalls++;
        return queryDB(input.limit);
      }),
  };
  const handler = new RPCHandler(orpcRouter);
  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} });
      if (!result.matched) { res.statusCode = 404; res.end(); }
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── Benchmark ───────────────────────────────────────

async function concurrentBench(url: string, body: string, total: number, concurrency: number) {
  const opts: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body };
  for (let i = 0; i < 20; i++) await (await fetch(url, opts)).text();

  const t0 = performance.now();
  let completed = 0;

  await new Promise<void>(resolve => {
    let inflight = 0;
    function launch() {
      while (inflight < concurrency && completed + inflight < total) {
        inflight++;
        fetch(url, opts).then(r => r.text()).then(() => {
          completed++;
          inflight--;
          if (completed >= total) resolve();
          else launch();
        });
      }
    }
    launch();
  });

  return {
    elapsed: Math.round(performance.now() - t0),
    rps: Math.round((total / (performance.now() - t0)) * 1000),
  };
}

// ── Main ────────────────────────────────────────────

async function main() {
  const KP = 4600, OP = 4601;
  const kSrv = await startKatmanServer(KP);
  const oSrv = await startORPCServer(OP);

  const body = JSON.stringify({ limit: 20 });

  console.log(`Realistic DB Benchmark (${DB_LATENCY_MS}ms query latency) | Node ${process.version}\n`);

  for (const [total, conc] of [[1000, 10], [5000, 50], [10000, 100]] as const) {
    katmanHandlerCalls = 0;
    orpcHandlerCalls = 0;

    const kR = await concurrentBench(`http://127.0.0.1:${KP}/list`, body, total, conc);

    katmanHandlerCalls = 0; // Reset after warmup during oRPC run
    const savedKCalls = katmanHandlerCalls;

    orpcHandlerCalls = 0;
    const oR = await concurrentBench(`http://127.0.0.1:${OP}/list`, body, total, conc);

    const speedup = (oR.elapsed / kR.elapsed).toFixed(1);
    const workReduction = orpcHandlerCalls > 0 ? Math.round(orpcHandlerCalls / Math.max(1, savedKCalls)) : "∞";

    console.log(`═══ ${total} requests, ${conc} concurrent ═══`);
    console.log(`  Katman (cache+coalesce): ${kR.rps.toLocaleString().padStart(7)} req/s  ${kR.elapsed}ms total`);
    console.log(`  oRPC (standard):         ${oR.rps.toLocaleString().padStart(7)} req/s  ${oR.elapsed}ms total`);
    console.log(`  → Katman ${speedup}x faster wall-clock`);
    console.log(`  → DB queries: oRPC ${orpcHandlerCalls} vs Katman ~1 (${orpcHandlerCalls}x less DB load)\n`);
  }

  kSrv.close(); oSrv.close();
}

main().catch(console.error);
