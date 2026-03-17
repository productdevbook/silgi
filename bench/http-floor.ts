/**
 * Find the absolute floor of Node.js HTTP performance.
 * Compare: bare node → katman → oRPC
 * Shows exactly how much overhead each framework adds.
 *
 * Run: node --experimental-strip-types bench/http-floor.ts
 */

import { createServer, type Server } from "node:http";
import { z } from "zod";

import { katman } from "../src/api/katman.ts";
import { compileRouter, ContextPool } from "../src/api/compile.ts";
import { os as orpcOs } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";

const N = 5000;

// ── 1. Bare Node.js — absolute minimum ─────────────

function startBareNode(port: number): Promise<Server> {
  const body = '{"status":"ok"}';
  return new Promise(r => {
    const s = createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── 2. Bare + JSON.stringify ────────────────────────

function startBareStringify(port: number): Promise<Server> {
  return new Promise(r => {
    const s = createServer((req, res) => {
      req.resume();
      const body = JSON.stringify({ status: "ok" });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(body);
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── 3. Bare + body read + JSON.parse + stringify ────

function startBareFullCycle(port: number): Promise<Server> {
  return new Promise(r => {
    const s = createServer((req, res) => {
      let body = "";
      req.on("data", (d: Buffer) => { body += d; });
      req.on("end", () => {
        const input = body ? JSON.parse(body) : undefined;
        const output = JSON.stringify({ echo: input?.message ?? "none" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(output);
      });
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── 4. Katman ───────────────────────────────────────

function startKatman(port: number): Promise<Server> {
  const k = katman({ context: () => ({}) });
  const router = k.router({
    health: k.query(async () => ({ status: "ok" })),
    echo: k.query(
      z.object({ message: z.string() }) as any,
      async ({ input }: any) => ({ echo: input.message }),
    ),
  });
  const flat = compileRouter(router);
  const pool = new ContextPool();
  const sig = new AbortController().signal;

  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const u = req.url ?? "/";
      const q = u.indexOf("?");
      const p = q === -1 ? u.slice(1) : u.slice(1, q);
      const route = flat.get(p);
      if (!route) { res.writeHead(404); res.end(); return; }
      const ctx = pool.borrow();
      try {
        let inp: unknown;
        const cl = req.headers["content-length"];
        if (req.method !== "GET" && cl && cl !== "0") {
          const t: string = await new Promise(r => {
            let b = ""; req.on("data", (d: Buffer) => { b += d; }); req.on("end", () => r(b));
          });
          if (t) inp = JSON.parse(t);
        } else { req.resume(); }
        const pr = route.handler(ctx, inp, sig);
        const out = pr instanceof Promise ? await pr : pr;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(route.stringify(out));
      } catch (e: any) {
        res.writeHead(e.status ?? 500);
        res.end(JSON.stringify({ error: e.message }));
      } finally { pool.release(ctx); }
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── 5. oRPC ─────────────────────────────────────────

function startORPC(port: number): Promise<Server> {
  const router = {
    health: orpcOs.handler(async () => ({ status: "ok" })),
    echo: orpcOs.input(z.object({ message: z.string() })).handler(
      async ({ input }) => ({ echo: input.message }),
    ),
  };
  const handler = new RPCHandler(router);
  return new Promise(r => {
    const s = createServer(async (req, res) => {
      const result = await handler.handle(req, res, { context: {} });
      if (!result.matched) { res.writeHead(404); res.end(); }
    });
    s.listen(port, "127.0.0.1", () => r(s));
  });
}

// ── Benchmark ───────────────────────────────────────

async function bench(url: string, body: string | null, n: number) {
  const opts: RequestInit = { method: "POST" };
  if (body) { opts.headers = { "content-type": "application/json" }; opts.body = body; }
  for (let i = 0; i < 200; i++) await (await fetch(url, opts)).text();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) await (await fetch(url, opts)).text();
  const elapsed = performance.now() - t0;
  return { avg: elapsed / n, rps: Math.round((n / elapsed) * 1000) };
}

function fmt(ms: number) { return `${(ms * 1000).toFixed(0)}µs`; }

// ── Main ────────────────────────────────────────────

async function main() {
  const ports = { bare: 4700, bareStr: 4701, bareFull: 4702, katman: 4703, orpc: 4704 };
  const servers = await Promise.all([
    startBareNode(ports.bare),
    startBareStringify(ports.bareStr),
    startBareFullCycle(ports.bareFull),
    startKatman(ports.katman),
    startORPC(ports.orpc),
  ]);

  console.log(`HTTP Floor Analysis | ${N} requests | Node ${process.version}\n`);

  // Test 1: Simple response (no body read)
  console.log("═══ Simple Response (POST, no input needed) ═══\n");
  const bare = await bench(`http://127.0.0.1:${ports.bare}/`, null, N);
  const bareStr = await bench(`http://127.0.0.1:${ports.bareStr}/`, null, N);
  const kat = await bench(`http://127.0.0.1:${ports.katman}/health`, null, N);
  const orpc = await bench(`http://127.0.0.1:${ports.orpc}/health`, null, N);

  const bareUs = bare.avg * 1000;
  const katOverhead = (kat.avg - bare.avg) * 1000;
  const orpcOverhead = (orpc.avg - bare.avg) * 1000;

  console.log(`  Bare Node (floor):     ${fmt(bare.avg)}  ${bare.rps}/s`);
  console.log(`  Bare + stringify:      ${fmt(bareStr.avg)}  ${bareStr.rps}/s  (+${((bareStr.avg - bare.avg) * 1000).toFixed(0)}µs)`);
  console.log(`  Katman:                ${fmt(kat.avg)}  ${kat.rps}/s  (+${katOverhead.toFixed(0)}µs overhead)`);
  console.log(`  oRPC:                  ${fmt(orpc.avg)}  ${orpc.rps}/s  (+${orpcOverhead.toFixed(0)}µs overhead)`);
  console.log(`\n  Katman overhead: ${katOverhead.toFixed(0)}µs (${(katOverhead / bareUs * 100).toFixed(0)}% of floor)`);
  console.log(`  oRPC overhead:   ${orpcOverhead.toFixed(0)}µs (${(orpcOverhead / bareUs * 100).toFixed(0)}% of floor)`);
  console.log(`  Katman is ${(orpcOverhead / Math.max(1, katOverhead)).toFixed(1)}x less overhead than oRPC`);

  // Test 2: With body read + validation
  console.log("\n═══ With Body Read + Validation ═══\n");
  const body = JSON.stringify({ message: "hello world" });
  const bareFull2 = await bench(`http://127.0.0.1:${ports.bareFull}/`, body, N);
  const kat2 = await bench(`http://127.0.0.1:${ports.katman}/echo`, body, N);
  const orpc2 = await bench(`http://127.0.0.1:${ports.orpc}/echo`, body, N);

  const bareFullUs = bareFull2.avg * 1000;
  const katOverhead2 = (kat2.avg - bareFull2.avg) * 1000;
  const orpcOverhead2 = (orpc2.avg - bareFull2.avg) * 1000;

  console.log(`  Bare (read+parse+stringify): ${fmt(bareFull2.avg)}  ${bareFull2.rps}/s`);
  console.log(`  Katman:                      ${fmt(kat2.avg)}  ${kat2.rps}/s  (+${katOverhead2.toFixed(0)}µs overhead)`);
  console.log(`  oRPC:                        ${fmt(orpc2.avg)}  ${orpc2.rps}/s  (+${orpcOverhead2.toFixed(0)}µs overhead)`);
  console.log(`\n  Katman overhead: ${katOverhead2.toFixed(0)}µs`);
  console.log(`  oRPC overhead:   ${orpcOverhead2.toFixed(0)}µs`);
  console.log(`  Katman is ${(orpcOverhead2 / Math.max(1, katOverhead2)).toFixed(1)}x less overhead than oRPC`);

  for (const s of servers) s.close();
}

main().catch(console.error);
