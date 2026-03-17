/**
 * Run all benchmarks and update BENCHMARKS.md automatically.
 *
 * Usage: node --experimental-strip-types bench/update-benchmarks.ts
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import os from "node:os";

// ── Schemas ─────────────────────────────────────────

const EchoInput = z.object({ message: z.string() });
const GuardedInput = z.object({ name: z.string() });

// ── Katman Setup ────────────────────────────────────

import { katman } from "../src/api/katman.ts";
import { compileProcedure, compileRouter, ContextPool } from "../src/api/compile.ts";
import type { GuardDef, WrapDef } from "../src/api/types.ts";
import { ResponseCache } from "../src/api/response-cache.ts";
import { RequestCoalescer } from "../src/api/coalesce.ts";

const k = katman({ context: () => ({}) });
const auth = k.guard(() => ({ userId: 1 }));

const katmanRouter = k.router({
  health: k.query(async () => ({ status: "ok" })),
  echo: k.query(EchoInput as any, async ({ input }: any) => ({ echo: input.message })),
  guarded: k.mutation({
    use: [auth],
    input: GuardedInput as any,
    resolve: async ({ input, ctx }: any) => ({ name: input.name, by: ctx.userId }),
  }),
});

// ── oRPC Setup ──────────────────────────────────────

import { os as orpcOs } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";

const orpcRouter = {
  health: orpcOs.handler(async () => ({ status: "ok" })),
  echo: orpcOs.input(EchoInput).handler(async ({ input }) => ({ echo: input.message })),
  guarded: orpcOs
    .use(async ({ next }) => next({ context: { userId: 1 } }))
    .input(GuardedInput)
    .handler(async ({ input, context }) => ({
      name: input.name,
      by: (context as any).userId,
    })),
};

// ── H3 v2 Setup ─────────────────────────────────────

import { H3, readBody } from "h3";

// ── Pipeline Benchmark ──────────────────────────────

import { compilePipeline } from "../src/core/pipeline.ts";
import { validateSchema } from "../src/core/schema.ts";
import type { Middleware } from "../src/core/pipeline.ts";

interface PipelineResult {
  name: string;
  orpc_ns: number;
  katman_ns: number;
  speedup: string;
  memory_orpc?: string;
  memory_katman?: string;
}

async function runPipelineBenchmarks(): Promise<PipelineResult[]> {
  const results: PipelineResult[] = [];
  const signal = AbortSignal.timeout(30_000);
  const testInput = { name: "Alice", age: 30 };
  const InputSchema = z.object({ name: z.string(), age: z.number() });
  const RUNS = 50_000;

  // Helper: measure average ns
  async function measure(fn: () => Promise<unknown>, runs: number): Promise<number> {
    // Warmup
    for (let i = 0; i < 1000; i++) await fn();
    const start = performance.now();
    for (let i = 0; i < runs; i++) await fn();
    return ((performance.now() - start) / runs) * 1_000_000; // ms → ns
  }

  // 1. No middleware
  const orpc1 = orpcOs.handler(async ({ input }) => ({ result: input }));
  const orpc1Client = (await import("@orpc/server")).createRouterClient({ p: orpc1 }, { context: {} });
  const katman1 = compileProcedure({
    type: "query", input: null, output: null, errors: null, use: null,
    resolve: async ({ input }: any) => ({ result: input }), route: null,
  });

  const o1 = await measure(() => (orpc1Client as any).p(testInput), RUNS);
  const k1 = await measure(() => katman1({}, testInput, signal), RUNS);
  results.push({ name: "No middleware", orpc_ns: Math.round(o1), katman_ns: Math.round(k1), speedup: `${(o1 / k1).toFixed(1)}x` });

  // 2. Zod input validation
  const orpc2 = orpcOs.input(InputSchema).handler(async ({ input }) => input);
  const orpc2Client = (await import("@orpc/server")).createRouterClient({ p: orpc2 }, { context: {} });
  const katman2 = compileProcedure({
    type: "query", input: InputSchema as any, output: null, errors: null, use: null,
    resolve: async ({ input }: any) => input, route: null,
  });

  const o2 = await measure(() => (orpc2Client as any).p(testInput), RUNS);
  const k2 = await measure(() => katman2({}, testInput, signal), RUNS);
  results.push({ name: "Zod input validation", orpc_ns: Math.round(o2), katman_ns: Math.round(k2), speedup: `${(o2 / k2).toFixed(1)}x` });

  // 3. 3 middleware + Zod
  const orpc3 = orpcOs
    .use(async ({ next }) => next({ context: { a: 1 } }))
    .use(async ({ next }) => next({ context: { b: 2 } }))
    .use(async ({ next }) => next({ context: { c: 3 } }))
    .input(InputSchema).handler(async ({ input }) => input);
  const orpc3Client = (await import("@orpc/server")).createRouterClient({ p: orpc3 }, { context: {} });
  const katman3 = compileProcedure({
    type: "mutation", input: InputSchema as any, output: null, errors: null,
    use: [
      { kind: "guard", fn: () => ({ a: 1 }) } as GuardDef,
      { kind: "guard", fn: () => ({ b: 2 }) } as GuardDef,
      { kind: "guard", fn: () => ({ c: 3 }) } as GuardDef,
    ],
    resolve: async ({ input }: any) => input, route: null,
  });

  const o3 = await measure(() => (orpc3Client as any).p(testInput), RUNS);
  const k3 = await measure(() => katman3({}, testInput, signal), RUNS);
  results.push({ name: "3 middleware + Zod", orpc_ns: Math.round(o3), katman_ns: Math.round(k3), speedup: `${(o3 / k3).toFixed(1)}x` });

  // 4. 5 middleware + Zod
  const orpc4 = orpcOs
    .use(async ({ next }) => next({ context: { a: 1 } }))
    .use(async ({ next }) => next({ context: { b: 2 } }))
    .use(async ({ next }) => next({ context: { c: 3 } }))
    .use(async ({ next }) => { const r = await next(); return r; })
    .use(async ({ next }) => { const r = await next(); return r; })
    .input(InputSchema).handler(async ({ input }) => input);
  const orpc4Client = (await import("@orpc/server")).createRouterClient({ p: orpc4 }, { context: {} });
  const katman4 = compileProcedure({
    type: "mutation", input: InputSchema as any, output: null, errors: null,
    use: [
      { kind: "guard", fn: () => ({ a: 1 }) } as GuardDef,
      { kind: "guard", fn: () => ({ b: 2 }) } as GuardDef,
      { kind: "guard", fn: () => ({ c: 3 }) } as GuardDef,
      { kind: "wrap", fn: async (_: any, next: any) => next() } as WrapDef,
      { kind: "wrap", fn: async (_: any, next: any) => next() } as WrapDef,
    ],
    resolve: async ({ input }: any) => input, route: null,
  });

  const o4 = await measure(() => (orpc4Client as any).p(testInput), RUNS);
  const k4 = await measure(() => katman4({}, testInput, signal), RUNS);
  results.push({ name: "5 middleware + Zod", orpc_ns: Math.round(o4), katman_ns: Math.round(k4), speedup: `${(o4 / k4).toFixed(1)}x` });

  return results;
}

// ── HTTP Benchmark ──────────────────────────────────

interface HTTPResult {
  name: string;
  katman_us: number;
  katman_rps: number;
  h3_us: number;
  h3_rps: number;
  orpc_us: number;
  orpc_rps: number;
}

async function httpBench(url: string, body: string | null, n: number) {
  const opts: RequestInit = { method: "POST" };
  if (body) { opts.headers = { "content-type": "application/json" }; opts.body = body; }
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

async function runHTTPBenchmarks(): Promise<HTTPResult[]> {
  const N = 3000;
  const KP = 4300, HP = 4301, OP = 4302;

  // Katman server
  const flat = compileRouter(katmanRouter);
  const pool = new ContextPool();
  const sig = new AbortController().signal;
  const jsonH = { "content-type": "application/json" };
  const kSrv: Server = await new Promise(r => {
    const s = createServer((req, res) => {
      const u = req.url ?? "/"; const q = u.indexOf("?");
      const p = q === -1 ? u.slice(1) : u.slice(1, q);
      const route = flat.get(p);
      if (!route) { res.writeHead(404); res.end(); return; }

      // No body needed: sync fast path — zero async, zero Promise
      const cl = req.headers["content-length"];
      if (!cl || cl === "0" || req.method === "GET" || req.method === "HEAD") {
        if (cl) req.resume(); // only drain if there's a body to drain
        const ctx = pool.borrow();
        try {
          const r = route.handler(ctx, undefined, sig);
          if (r instanceof Promise) {
            r.then(out => { res.writeHead(200, jsonH); res.end(route.stringify(out)); })
             .catch(e => { res.writeHead(e.status ?? 500); res.end(); })
             .finally(() => pool.release(ctx));
          } else {
            res.writeHead(200, jsonH); res.end(route.stringify(r)); pool.release(ctx);
          }
        } catch (e: any) { res.writeHead(e.status ?? 500); res.end(); pool.release(ctx); }
        return;
      }

      // Body needed: async path
      let body = "";
      req.on("data", (d: Buffer) => { body += d; });
      req.on("end", () => {
        const ctx = pool.borrow();
        try {
          const inp = body ? JSON.parse(body) : undefined;
          const r = route.handler(ctx, inp, sig);
          if (r instanceof Promise) {
            r.then(out => { res.writeHead(200, jsonH); res.end(route.stringify(out)); })
             .catch(e => { res.writeHead(e.status ?? 500); res.end(); })
             .finally(() => pool.release(ctx));
          } else {
            res.writeHead(200, jsonH); res.end(route.stringify(r)); pool.release(ctx);
          }
        } catch (e: any) { res.writeHead(e.status ?? 500); res.end(); pool.release(ctx); }
      });
    });
    s.listen(KP, "127.0.0.1", () => r(s));
  });

  // H3 server
  const h3App = new H3();
  h3App.all("/health", () => ({ status: "ok" }));
  h3App.all("/echo", async (ev: any) => { const b = await readBody(ev); return { echo: EchoInput.parse(b).message }; });
  h3App.all("/guarded", async (ev: any) => { const b = await readBody(ev); return { name: GuardedInput.parse(b).name, by: 1 }; });
  const hSrv: Server = await new Promise(r => {
    const s = createServer(async (req, res) => {
      const url = `http://127.0.0.1:${HP}${req.url}`;
      const h = new Headers(); for (const [k,v] of Object.entries(req.headers)) { if(v) h.set(k, Array.isArray(v)?v[0]!:v); }
      const body = await new Promise<string>(r => { let b=""; req.on("data",(d:Buffer)=>{b+=d}); req.on("end",()=>r(b)); });
      const rq = new Request(url, { method: req.method, headers: h, body: req.method!=="GET"&&req.method!=="HEAD"?body||undefined:undefined });
      const rs = await h3App.fetch(rq);
      res.statusCode = rs.status; rs.headers.forEach((v,k) => res.setHeader(k,v)); res.end(await rs.text());
    });
    s.listen(HP, "127.0.0.1", () => r(s));
  });

  // oRPC server
  const orpcHandler = new RPCHandler(orpcRouter);
  const oSrv: Server = await new Promise(r => {
    const s = createServer(async (req, res) => {
      const result = await orpcHandler.handle(req, res, { context: {} });
      if (!result.matched) { res.statusCode = 404; res.end(); }
    });
    s.listen(OP, "127.0.0.1", () => r(s));
  });

  const results: HTTPResult[] = [];
  const scenarios = [
    { name: "Simple (no mw, no validation)", path: "health", body: null },
    { name: "Zod input validation", path: "echo", body: JSON.stringify({ message: "hello" }) },
    { name: "Guard + Zod validation", path: "guarded", body: JSON.stringify({ name: "Alice" }) },
  ];

  for (const s of scenarios) {
    const kR = await httpBench(`http://127.0.0.1:${KP}/${s.path}`, s.body, N);
    const hR = await httpBench(`http://127.0.0.1:${HP}/${s.path}`, s.body, N);
    const oR = await httpBench(`http://127.0.0.1:${OP}/${s.path}`, s.body, N);
    results.push({
      name: s.name,
      katman_us: Math.round(kR.avg * 1000), katman_rps: kR.rps,
      h3_us: Math.round(hR.avg * 1000), h3_rps: hR.rps,
      orpc_us: Math.round(oR.avg * 1000), orpc_rps: oR.rps,
    });
  }

  kSrv.close(); hSrv.close(); oSrv.close();
  return results;
}

// ── Generate Markdown ───────────────────────────────

async function main() {
  console.log("Running pipeline benchmarks...");
  const pipelineResults = await runPipelineBenchmarks();

  console.log("Running HTTP benchmarks...");
  const httpResults = await runHTTPBenchmarks();

  console.log("Updating BENCHMARKS.md...");

  const date = new Date().toISOString().split("T")[0];
  const cpus = os.cpus();
  const env = [
    `| Key | Value |`,
    `|---|---|`,
    `| CPU | ${cpus[0]?.model?.trim()} |`,
    `| Cores | ${cpus.length} |`,
    `| Node.js | ${process.version} |`,
    `| OS | ${os.platform()} ${os.arch()} |`,
  ].join("\n");

  const pipelineTable = [
    `| Scenario | oRPC | Katman | Speedup |`,
    `|---|---|---|---|`,
    ...pipelineResults.map(r =>
      `| ${r.name} | ${r.orpc_ns} ns | **${r.katman_ns} ns** | **${r.speedup}** |`
    ),
  ].join("\n");

  const httpTable = [
    `| Scenario | Katman | H3 v2 | oRPC | vs H3 | vs oRPC |`,
    `|---|---|---|---|---|---|`,
    ...httpResults.map(r => {
      const vsH3 = r.h3_us > r.katman_us
        ? `**${(r.h3_us / r.katman_us).toFixed(1)}x faster**`
        : `${(r.katman_us / r.h3_us).toFixed(1)}x slower`;
      const vsOr = r.orpc_us > r.katman_us
        ? `**${(r.orpc_us / r.katman_us).toFixed(1)}x faster**`
        : `${(r.katman_us / r.orpc_us).toFixed(1)}x slower`;
      return `| ${r.name} | **${r.katman_us}µs** (${r.katman_rps}/s) | ${r.h3_us}µs (${r.h3_rps}/s) | ${r.orpc_us}µs (${r.orpc_rps}/s) | ${vsH3} | ${vsOr} |`;
    }),
  ].join("\n");

  const md = `# Benchmarks

> Auto-generated by \`pnpm bench\`. Last updated: **${date}**

## Environment

${env}

## Pipeline Performance (pure execution, no HTTP)

Measures raw middleware pipeline overhead using [mitata](https://github.com/evanwashere/mitata).

${pipelineTable}

## HTTP Performance (full request/response over TCP)

Real-world latency — 3000 sequential requests per scenario.

${httpTable}

## How to run

\`\`\`sh
pnpm bench           # run all benchmarks and update this file
pnpm bench:orpc      # oRPC vs Katman pipeline (mitata)
pnpm bench:h3        # Katman vs H3 v2 vs oRPC (HTTP)
pnpm bench:http      # Katman vs oRPC (HTTP, detailed)
pnpm bench:pipeline  # v1 vs v2 internal comparison
pnpm bench:micro     # per-operation bottleneck analysis
\`\`\`
`;

  await writeFile("BENCHMARKS.md", md);
  console.log(`\nBENCHMARKS.md updated (${date})\n`);

  // Print summary
  console.log("Pipeline:");
  for (const r of pipelineResults) console.log(`  ${r.name}: ${r.speedup} faster`);
  console.log("\nHTTP:");
  for (const r of httpResults) console.log(`  ${r.name}: Katman ${r.katman_us}µs | H3 ${r.h3_us}µs | oRPC ${r.orpc_us}µs`);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
