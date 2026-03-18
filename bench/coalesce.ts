/**
 * Benchmark: Impact of request coalescing under high concurrency
 *
 * Simulates real-world scenario: many clients requesting the same data.
 * Tests: cache + coalescing vs no optimizations.
 *
 * Run: node --experimental-strip-types bench/coalesce.ts
 */

import { createServer, type Server } from "node:http";
import { z } from "zod";

import { katman } from "../src/katman.ts";
import { compileRouter, ContextPool, type CompiledRoute } from "../src/compile.ts";
import { ResponseCache } from "../src/response-cache.ts";
import { RequestCoalescer } from "../src/coalesce.ts";

import { os as orpcOs } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";

const PORT_K_PLAIN = 4500;
const PORT_K_CACHED = 4501;
const PORT_K_FULL = 4502;
const PORT_ORPC = 4503;

// ── Simulated DB call (realistic latency) ───────────

let handlerCallCount = { kPlain: 0, kCached: 0, kFull: 0, orpc: 0 };

function simulateDB(items: number): unknown[] {
  // Simulates a fast in-memory lookup (like Redis or cached DB)
  return Array.from({ length: items }, (_, i) => ({
    id: i + 1, name: `User ${i + 1}`, email: `u${i + 1}@t.com`, active: true,
  }));
}

// ── Katman Setup ────────────────────────────────────

const k = katman({ context: () => ({}) });
const katmanRouter = k.router({
  list: k.query(
    z.object({ limit: z.number() }) as any,
    async ({ input }: any) => simulateDB(input.limit),
  ),
});

// ── Servers ─────────────────────────────────────────

async function startServer(
  port: number,
  mode: "plain" | "cached" | "full",
): Promise<Server> {
  const flat = compileRouter(katmanRouter);
  const pool = new ContextPool();
  const sig = new AbortController().signal;
  const cache = mode !== "plain" ? new ResponseCache({ maxSize: 1000, ttlMs: 10_000 }) : null;
  const coalescer = mode === "full" ? new RequestCoalescer() : null;

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

      // CACHE check
      if (cache) {
        const hit = cache.get(cacheKey);
        if (hit) {
          res.statusCode = 200;
          res.setHeader("content-type", "application/json");
          res.end(hit);
          return;
        }
      }

      // COALESCE + execute
      const execute = async () => {
        const ctx = pool.borrow();
        try {
          if (mode === "plain") handlerCallCount.kPlain++;
          else if (mode === "cached") handlerCallCount.kCached++;
          else handlerCallCount.kFull++;

          const pr = route.handler(ctx, rawInput, sig);
          const out = pr instanceof Promise ? await pr : pr;
          return route.stringify(out);
        } finally {
          pool.release(ctx);
        }
      };

      try {
        const body = coalescer
          ? await coalescer.execute(cacheKey, execute)
          : await execute();

        if (cache) cache.set(cacheKey, body);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(body);
      } catch (e: any) {
        res.statusCode = e.status ?? 500;
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

async function startORPCServer(): Promise<Server> {
  const orpcRouter = {
    list: orpcOs
      .input(z.object({ limit: z.number() }))
      .handler(async ({ input }) => {
        handlerCallCount.orpc++;
        return simulateDB(input.limit);
      }),
  };
  const handler = new RPCHandler(orpcRouter);
  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} });
      if (!result.matched) { res.statusCode = 404; res.end(); }
    });
    s.listen(PORT_ORPC, "127.0.0.1", () => r(s));
  });
}

// ── Benchmark ───────────────────────────────────────

async function concurrentBench(url: string, body: string, total: number, concurrency: number) {
  const opts: RequestInit = { method: "POST", headers: { "content-type": "application/json" }, body };
  // Warmup
  for (let i = 0; i < 50; i++) await (await fetch(url, opts)).text();

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

// ── Main ────────────────────────────────────────────

async function main() {
  const sPlain = await startServer(PORT_K_PLAIN, "plain");
  const sCached = await startServer(PORT_K_CACHED, "cached");
  const sFull = await startServer(PORT_K_FULL, "full");
  const sOrpc = await startORPCServer();

  const body = JSON.stringify({ limit: 20 });
  const TOTAL = 10_000;

  console.log(`Coalescing Benchmark | ${TOTAL} requests | Node ${process.version}\n`);

  // Reset counters
  handlerCallCount = { kPlain: 0, kCached: 0, kFull: 0, orpc: 0 };

  for (const conc of [10, 50, 100, 200]) {
    handlerCallCount = { kPlain: 0, kCached: 0, kFull: 0, orpc: 0 };

    const kPlain = await concurrentBench(`http://127.0.0.1:${PORT_K_PLAIN}/list`, body, TOTAL, conc);
    const kCached = await concurrentBench(`http://127.0.0.1:${PORT_K_CACHED}/list`, body, TOTAL, conc);
    const kFull = await concurrentBench(`http://127.0.0.1:${PORT_K_FULL}/list`, body, TOTAL, conc);
    const oRpc = await concurrentBench(`http://127.0.0.1:${PORT_ORPC}/list`, body, TOTAL, conc);

    const speedup = (oRpc.elapsed / kFull.elapsed).toFixed(1);

    console.log(`═══ Concurrency: ${conc} ═══`);
    console.log(`  Katman (plain):          ${kPlain.rps.toLocaleString().padStart(7)} req/s  (${handlerCallCount.kPlain} handler calls)`);
    console.log(`  Katman (cache):          ${kCached.rps.toLocaleString().padStart(7)} req/s  (${handlerCallCount.kCached} handler calls)`);
    console.log(`  Katman (cache+coalesce): ${kFull.rps.toLocaleString().padStart(7)} req/s  (${handlerCallCount.kFull} handler calls)`);
    console.log(`  oRPC:                    ${oRpc.rps.toLocaleString().padStart(7)} req/s  (${handlerCallCount.orpc} handler calls)`);
    console.log(`  → Katman full ${speedup}x faster than oRPC`);
    console.log(`  → Handler calls: Katman ${handlerCallCount.kFull} vs oRPC ${handlerCallCount.orpc} (${(handlerCallCount.orpc / Math.max(1, handlerCallCount.kFull)).toFixed(0)}x less work)\n`);
  }

  sPlain.close(); sCached.close(); sFull.close(); sOrpc.close();
}

main().catch(console.error);
