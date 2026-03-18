/**
 * Experimental: Sync pipeline vs Async pipeline vs Current
 *
 * Tests whether eliminating async for sync-capable procedures
 * makes a measurable difference.
 */
import { bench, run, summary } from "mitata";
import { z } from "zod";
import { compileProcedure } from "../src/compile.ts";
import type { GuardDef } from "../src/types.ts";

const signal = AbortSignal.timeout(30_000);

// ── Scenario: 3 sync guards + sync handler ──────────

// Current: async pipeline (always creates Promise)
const currentPipeline = compileProcedure({
  type: "query", input: null, output: null, errors: null,
  use: [
    { kind: "guard", fn: () => ({ a: 1 }) } as GuardDef,
    { kind: "guard", fn: () => ({ b: 2 }) } as GuardDef,
    { kind: "guard", fn: () => ({ c: 3 }) } as GuardDef,
  ],
  resolve: ({ ctx }: any) => ({ sum: ctx.a + ctx.b + ctx.c }), // SYNC handler
  route: null,
});

// Experimental: sync pipeline (no async, no Promise)
function syncGuard1(ctx: Record<string, unknown>) { ctx.a = 1; }
function syncGuard2(ctx: Record<string, unknown>) { ctx.b = 2; }
function syncGuard3(ctx: Record<string, unknown>) { ctx.c = 3; }
function syncHandler(ctx: any) { return { sum: ctx.a + ctx.b + ctx.c }; }

function syncPipeline(ctx: Record<string, unknown>, input: unknown) {
  syncGuard1(ctx);
  syncGuard2(ctx);
  syncGuard3(ctx);
  return syncHandler(ctx);
}

// Experimental: compiled sync pipeline (detects sync at compile time)
function compileSyncPipeline(guards: Array<(ctx: Record<string, unknown>) => void>, handler: Function) {
  const g = guards;
  const h = handler;
  const n = g.length;

  // Unrolled dispatch based on guard count
  switch (n) {
    case 0: return (ctx: any, input: unknown) => h(ctx, input);
    case 1: return (ctx: any, input: unknown) => { g[0]!(ctx); return h(ctx, input); };
    case 2: return (ctx: any, input: unknown) => { g[0]!(ctx); g[1]!(ctx); return h(ctx, input); };
    case 3: return (ctx: any, input: unknown) => { g[0]!(ctx); g[1]!(ctx); g[2]!(ctx); return h(ctx, input); };
    default: return (ctx: any, input: unknown) => { for (const fn of g) fn(ctx); return h(ctx, input); };
  }
}

const compiledSync = compileSyncPipeline(
  [syncGuard1, syncGuard2, syncGuard3],
  syncHandler,
);

// Experimental: hybrid (returns value or Promise, caller decides)
function hybridPipeline(ctx: Record<string, unknown>, input: unknown): unknown {
  syncGuard1(ctx);
  syncGuard2(ctx);
  syncGuard3(ctx);
  return syncHandler(ctx);
}

// ── Scenario: with Zod validation (always async) ────

const InputSchema = z.object({ name: z.string(), age: z.number() });
const testInput = { name: "Alice", age: 30 };

const currentWithZod = compileProcedure({
  type: "query", input: InputSchema as any, output: null, errors: null,
  use: [
    { kind: "guard", fn: () => ({ userId: 1 }) } as GuardDef,
  ],
  resolve: ({ input }: any) => ({ greeting: `Hi ${input.name}` }),
  route: null,
});

// ── Benchmarks ──────────────────────────────────────

console.log("Sync vs Async Pipeline — can we eliminate Promise overhead?\n");

summary(() => {
  bench("current (async, compiled guards)", async () => {
    await currentPipeline({}, null, signal);
  });

  bench("sync pipeline (hand-written)", () => {
    syncPipeline({}, null);
  });

  bench("sync pipeline (compiled, unrolled)", () => {
    compiledSync({}, null);
  });

  bench("hybrid (sync return, no await)", () => {
    const result = hybridPipeline({}, null);
    // No await — result is the value directly
  });
});

// How much does "resolving" a sync value via await cost?
summary(() => {
  const syncVal = () => ({ status: "ok" });
  const asyncVal = async () => ({ status: "ok" });

  bench("sync fn call (baseline)", () => {
    syncVal();
  });

  bench("await sync fn result", async () => {
    await syncVal();
  });

  bench("await async fn result", async () => {
    await asyncVal();
  });

  bench("check instanceof Promise + resolve", async () => {
    const r = syncVal();
    if (r instanceof Promise) await r; // never true, but V8 doesn't know that at first
  });
});

// Full HTTP handler simulation: sync vs async
summary(() => {
  const syncResponse = () => {
    const ctx: any = {};
    ctx.a = 1; ctx.b = 2; ctx.c = 3;
    const output = { sum: ctx.a + ctx.b + ctx.c };
    return JSON.stringify(output);
  };

  const asyncResponse = async () => {
    const ctx: any = {};
    ctx.a = 1; ctx.b = 2; ctx.c = 3;
    const output = { sum: ctx.a + ctx.b + ctx.c };
    return JSON.stringify(output);
  };

  bench("sync: guards + handler + stringify", () => {
    syncResponse();
  });

  bench("async: guards + handler + stringify", async () => {
    await asyncResponse();
  });
});

await run();
