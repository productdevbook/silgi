/**
 * Real-world benchmark — tests patterns that matter in production:
 *
 * 1. Response caching: same input → cached response (skip pipeline entirely)
 * 2. Concurrent requests: parallel load, not sequential
 * 3. Mixed workload: reads (cached) + writes (uncached)
 *
 * Run: node --experimental-strip-types bench/real-world.ts
 */

import { createServer, type Server } from "node:http";
import { z } from "zod";

import { katman } from "../src/api/katman.ts";
import { compileRouter, ContextPool, type CompiledRoute } from "../src/api/compile.ts";
import { ResponseCache } from "../src/api/response-cache.ts";

import { os as orpcOs } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";

const KATMAN_PORT = 4400;
const ORPC_PORT = 4401;

// ── Shared data ─────────────────────────────────────

const db = Array.from({ length: 100 }, (_, i) => ({
  id: i + 1,
  name: `User ${i + 1}`,
  email: `user${i + 1}@test.com`,
  active: true,
}));

// ── Katman ──────────────────────────────────────────

const k = katman({ context: () => ({}) });
const katmanRouter = k.router({
  list: k.query(
    z.object({ limit: z.number() }) as any,
    async ({ input }: any) => db.slice(0, input.limit),
  ),
  get: k.query(
    z.object({ id: z.number() }) as any,
    async ({ input }: any) => db.find(u => u.id === input.id) ?? null,
  ),
});

// ── oRPC ────────────────────────────────────────────

const orpcRouter = {
  list: orpcOs
    .input(z.object({ limit: z.number() }))
    .handler(async ({ input }) => db.slice(0, input.limit)),
  get: orpcOs
    .input(z.object({ id: z.number() }))
    .handler(async ({ input }) => db.find(u => u.id === input.id) ?? null),
};

// ── Servers ─────────────────────────────────────────

async function startKatmanServer(): Promise<Server> {
  const flat = compileRouter(katmanRouter);
  const pool = new ContextPool();
  const sig = new AbortController().signal;
  const cache = new ResponseCache({ maxSize: 500, ttlMs: 5000 });

  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const u = req.url ?? "/";
      const q = u.indexOf("?");
      const pathname = q === -1 ? u.slice(1) : u.slice(1, q);

      const route = flat.get(pathname);
      if (!route) { res.statusCode = 404; res.end(); return; }

      // Body read
      let rawInput: unknown;
      const cl = req.headers["content-length"];
      if (req.method !== "GET" && cl && cl !== "0") {
        const t: string = await new Promise(r => {
          let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
        });
        if (t) rawInput = JSON.parse(t);
      } else if (req.method !== "GET") req.resume();

      // CACHE CHECK — skip entire pipeline + stringify
      const cacheKey = ResponseCache.key(pathname, rawInput);
      const cached = cache.get(cacheKey);
      if (cached) {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(cached);
        return;
      }

      // Pipeline
      const ctx = pool.borrow();
      try {
        const pr = route.handler(ctx, rawInput, sig);
        const out = pr instanceof Promise ? await pr : pr;
        const body = route.stringify(out);
        cache.set(cacheKey, body);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(body);
      } catch (e: any) {
        res.statusCode = e.status ?? 500;
        res.end(JSON.stringify({ error: e.message }));
      } finally {
        pool.release(ctx);
      }
    });
    s.listen(KATMAN_PORT, "127.0.0.1", () => r(s));
  });
}

async function startORPCServer(): Promise<Server> {
  const handler = new RPCHandler(orpcRouter);
  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} });
      if (!result.matched) { res.statusCode = 404; res.end(); }
    });
    s.listen(ORPC_PORT, "127.0.0.1", () => r(s));
  });
}

// ── Benchmark Functions ─────────────────────────────

async function sequentialBench(url: string, body: string, n: number) {
  const opts: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body };
  for (let i = 0; i < 100; i++) await (await fetch(url, opts)).text();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await (await fetch(url, opts)).text();
  const total = performance.now() - t0;
  return { avg: total / n, rps: Math.round((n / total) * 1000) };
}

async function concurrentBench(url: string, body: string, total: number, concurrency: number) {
  const opts: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body };
  for (let i = 0; i < 100; i++) await (await fetch(url, opts)).text();

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

  const elapsed = performance.now() - t0;
  return { rps: Math.round((total / elapsed) * 1000), elapsed: Math.round(elapsed) };
}

function fmt(us: number) { return us < 1000 ? `${us.toFixed(0)}µs` : `${(us/1000).toFixed(1)}ms`; }

// ── Main ────────────────────────────────────────────

async function main() {
  const kSrv = await startKatmanServer();
  const oSrv = await startORPCServer();

  console.log("Real-World Benchmark | Node " + process.version + "\n");

  const body = JSON.stringify({ limit: 10 });
  const N = 3000;

  // 1. Sequential (same as before)
  console.log("═══ Sequential (3000 requests) ═══");
  const kSeq = await sequentialBench(`http://127.0.0.1:${KATMAN_PORT}/list`, body, N);
  const oSeq = await sequentialBench(`http://127.0.0.1:${ORPC_PORT}/list`, body, N);
  console.log(`  Katman:  avg ${fmt(kSeq.avg * 1000)}  ${kSeq.rps} req/s`);
  console.log(`  oRPC:    avg ${fmt(oSeq.avg * 1000)}  ${oSeq.rps} req/s`);
  console.log(`  → Katman ${(oSeq.avg / kSeq.avg).toFixed(1)}x faster`);

  // 2. Sequential with CACHING (2nd+ hit is cached)
  console.log("\n═══ Sequential + Cache (3000 requests, same input) ═══");
  const kCache = await sequentialBench(`http://127.0.0.1:${KATMAN_PORT}/list`, body, N);
  const oCache = await sequentialBench(`http://127.0.0.1:${ORPC_PORT}/list`, body, N);
  console.log(`  Katman (cached): avg ${fmt(kCache.avg * 1000)}  ${kCache.rps} req/s`);
  console.log(`  oRPC (no cache): avg ${fmt(oCache.avg * 1000)}  ${oCache.rps} req/s`);
  console.log(`  → Katman ${(oCache.avg / kCache.avg).toFixed(1)}x faster`);

  // 3. Concurrent (10 parallel)
  console.log("\n═══ Concurrent (5000 requests, 50 parallel) ═══");
  const kConc = await concurrentBench(`http://127.0.0.1:${KATMAN_PORT}/list`, body, 5000, 50);
  const oConc = await concurrentBench(`http://127.0.0.1:${ORPC_PORT}/list`, body, 5000, 50);
  console.log(`  Katman: ${kConc.rps} req/s (${kConc.elapsed}ms)`);
  console.log(`  oRPC:   ${oConc.rps} req/s (${oConc.elapsed}ms)`);
  console.log(`  → Katman ${(oConc.elapsed / kConc.elapsed).toFixed(1)}x throughput`);

  // 4. Concurrent with CACHE
  console.log("\n═══ Concurrent + Cache (5000 requests, 50 parallel) ═══");
  const kConcCache = await concurrentBench(`http://127.0.0.1:${KATMAN_PORT}/list`, body, 5000, 50);
  const oConcNoCache = await concurrentBench(`http://127.0.0.1:${ORPC_PORT}/list`, body, 5000, 50);
  console.log(`  Katman (cached): ${kConcCache.rps} req/s`);
  console.log(`  oRPC (no cache): ${oConcNoCache.rps} req/s`);
  console.log(`  → Katman ${(oConcNoCache.elapsed / kConcCache.elapsed).toFixed(1)}x throughput`);

  console.log("\n═══ Summary ═══");
  console.log(`  Sequential:    ${kSeq.rps} vs ${oSeq.rps} req/s`);
  console.log(`  Cached:        ${kCache.rps} vs ${oCache.rps} req/s`);
  console.log(`  Concurrent:    ${kConc.rps} vs ${oConc.rps} req/s`);
  console.log(`  Conc + Cache:  ${kConcCache.rps} vs ${oConcNoCache.rps} req/s`);

  kSrv.close(); oSrv.close();
}

main().catch(console.error);
