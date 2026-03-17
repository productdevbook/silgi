/**
 * Benchmark: Katman v1 (chain) vs v2 (guard/wrap) pipeline execution
 *
 * Measures the core overhead of the middleware pipeline —
 * the most performance-critical path in any RPC framework.
 *
 * Run: node --experimental-strip-types bench/pipeline.ts
 */

import { bench, run, summary, compact } from "mitata";
import { z } from "zod";

// ── Katman v1 (chain-based pipeline) ────────────────

import { compilePipeline as v1Compile } from "../src/core/pipeline.ts";
import type { Middleware, Handler } from "../src/core/pipeline.ts";

// ── Katman v2 (guard/wrap pipeline) ─────────────────

import { compileProcedure as v2Compile } from "../src/api/compile.ts";
import type { ProcedureDef, GuardDef, WrapDef } from "../src/api/types.ts";

// ── Shared schema ───────────────────────────────────

const inputSchema = z.object({ name: z.string(), age: z.number() });
const signal = AbortSignal.timeout(30_000);
const testInput = { name: "Alice", age: 30 };

// ═══════════════════════════════════════════════════
//  Scenario 1: No middleware — pure handler
// ═══════════════════════════════════════════════════

const v1_noMw = v1Compile(
  [],
  async ({ input }) => ({ result: input }),
  undefined,
  undefined,
  { inputValidationIndex: 0, outputValidationIndex: 0 },
);

const v2_noMw = v2Compile({
  type: "query",
  input: null,
  output: null,
  errors: null,
  use: null,
  resolve: async ({ input }: any) => ({ result: input }),
  route: null,
});

// ═══════════════════════════════════════════════════
//  Scenario 2: 3 sync context-enriching middleware
// ═══════════════════════════════════════════════════

// v1: 3 onion middlewares
const v1_3syncMw: Middleware[] = [
  async (opts: any) => opts.next({ context: { a: 1 } }),
  async (opts: any) => opts.next({ context: { b: 2 } }),
  async (opts: any) => opts.next({ context: { c: 3 } }),
];
const v1_3sync = v1Compile(
  v1_3syncMw,
  async ({ context }) => context,
  undefined,
  undefined,
  { inputValidationIndex: 0, outputValidationIndex: 0 },
);

// v2: 3 sync guards (zero closure)
const v2_3syncGuards: GuardDef[] = [
  { kind: "guard", fn: () => ({ a: 1 }) },
  { kind: "guard", fn: () => ({ b: 2 }) },
  { kind: "guard", fn: () => ({ c: 3 }) },
];
const v2_3sync = v2Compile({
  type: "query",
  input: null,
  output: null,
  errors: null,
  use: v2_3syncGuards,
  resolve: async ({ ctx }: any) => ctx,
  route: null,
});

// ═══════════════════════════════════════════════════
//  Scenario 3: 5 middleware (mixed sync/async)
// ═══════════════════════════════════════════════════

const v1_5mixMw: Middleware[] = [
  async (opts: any) => opts.next({ context: { a: 1 } }),
  async (opts: any) => opts.next({ context: { b: 2 } }),
  async (opts: any) => opts.next({ context: { c: 3 } }),
  async (opts: any) => { const r = await opts.next(); return r; }, // timing-like wrap
  async (opts: any) => { const r = await opts.next(); return r; }, // logging-like wrap
];
const v1_5mix = v1Compile(
  v1_5mixMw,
  async ({ context }) => context,
  undefined,
  undefined,
  { inputValidationIndex: 0, outputValidationIndex: 0 },
);

const v2_5mix = v2Compile({
  type: "query",
  input: null,
  output: null,
  errors: null,
  use: [
    { kind: "guard", fn: () => ({ a: 1 }) } as GuardDef,
    { kind: "guard", fn: () => ({ b: 2 }) } as GuardDef,
    { kind: "guard", fn: () => ({ c: 3 }) } as GuardDef,
    { kind: "wrap", fn: async (_ctx: any, next: any) => next() } as WrapDef,
    { kind: "wrap", fn: async (_ctx: any, next: any) => next() } as WrapDef,
  ],
  resolve: async ({ ctx }: any) => ctx,
  route: null,
});

// ═══════════════════════════════════════════════════
//  Scenario 4: With Zod input validation
// ═══════════════════════════════════════════════════

import { validateSchema } from "../src/core/schema.ts";

const v1_withValidation = v1Compile(
  [],
  async ({ input }) => input,
  (val) => validateSchema(inputSchema as any, val),
  undefined,
  { inputValidationIndex: 0, outputValidationIndex: 0 },
);

const v2_withValidation = v2Compile({
  type: "query",
  input: inputSchema as any,
  output: null,
  errors: null,
  use: null,
  resolve: async ({ input }: any) => input,
  route: null,
});

// ═══════════════════════════════════════════════════
//  Scenario 5: Full realistic (3 guards + 1 wrap + validation)
// ═══════════════════════════════════════════════════

const v1_full: Middleware[] = [
  async (opts: any) => opts.next({ context: { user: { id: 1 } } }),
  async (opts: any) => opts.next({ context: { permissions: ["read"] } }),
  async (opts: any) => opts.next({ context: { rateOk: true } }),
  async (opts: any) => { const r = await opts.next(); return r; }, // timing wrap
];
const v1_fullPipeline = v1Compile(
  v1_full,
  async ({ input, context }) => ({ input, userId: (context as any).user.id }),
  (val) => validateSchema(inputSchema as any, val),
  undefined,
  { inputValidationIndex: 3, outputValidationIndex: 999 },
);

const v2_fullPipeline = v2Compile({
  type: "mutation",
  input: inputSchema as any,
  output: null,
  errors: null,
  use: [
    { kind: "guard", fn: () => ({ user: { id: 1 } }) } as GuardDef,
    { kind: "guard", fn: () => ({ permissions: ["read"] }) } as GuardDef,
    { kind: "guard", fn: () => ({ rateOk: true }) } as GuardDef,
    { kind: "wrap", fn: async (_ctx: any, next: any) => next() } as WrapDef,
  ],
  resolve: async ({ input, ctx }: any) => ({ input, userId: ctx.user.id }),
  route: null,
});

// ═══════════════════════════════════════════════════
//  Run benchmarks
// ═══════════════════════════════════════════════════

summary(() => {
  bench("v1 chain — no middleware", async () => {
    await v1_noMw({}, testInput, signal, [], {}, {});
  });
  bench("v2 guard  — no middleware", async () => {
    await v2_noMw({}, testInput, signal);
  });
});

summary(() => {
  bench("v1 chain — 3 sync middleware", async () => {
    await v1_3sync({}, testInput, signal, [], {}, {});
  });
  bench("v2 guard  — 3 sync guards", async () => {
    await v2_3sync({}, testInput, signal);
  });
});

summary(() => {
  bench("v1 chain — 5 mixed middleware", async () => {
    await v1_5mix({}, testInput, signal, [], {}, {});
  });
  bench("v2 guard  — 3 guards + 2 wraps", async () => {
    await v2_5mix({}, testInput, signal);
  });
});

summary(() => {
  bench("v1 chain — with Zod validation", async () => {
    await v1_withValidation({}, testInput, signal, [], {}, {});
  });
  bench("v2 guard  — with Zod validation", async () => {
    await v2_withValidation({}, testInput, signal);
  });
});

summary(() => {
  bench("v1 chain — full realistic (3mw + 1wrap + zod)", async () => {
    await v1_fullPipeline({}, testInput, signal, [], {}, {});
  });
  bench("v2 guard  — full realistic (3guard + 1wrap + zod)", async () => {
    await v2_fullPipeline({}, testInput, signal);
  });
});

await run();
