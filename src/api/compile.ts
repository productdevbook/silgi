/**
 * Pipeline Compiler v3 — 2026 Optimized
 *
 * Innovations:
 * 1. UNROLLED GUARDS — 0-4 guard specialization (no loop, V8 inlines)
 * 2. FLAT MAP ROUTER — O(1) lookup via Map.get()
 * 3. CONTEXT POOL — pre-allocated, zero per-request allocation
 * 4. AbortSignal.any() — native signal composition
 * 5. Promise.withResolvers() — cleaner deferred patterns
 * 6. RESULT-BASED ERRORS — avoid throw for typed errors (optional)
 *
 * Benchmark target: 5-8x faster than oRPC
 */

import type { ProcedureDef, GuardDef, WrapDef, MiddlewareDef, ErrorDef } from "./types.ts";
import { validateSchema, type AnySchema } from "../core/schema.ts";
import { KatmanError } from "../core/error.ts";

/** Compiled pipeline — called per request */
export type CompiledHandler = (
  ctx: Record<string, unknown>,
  rawInput: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

// ── Helpers ─────────────────────────────────────────

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === "object" && typeof (value as any).then === "function";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function createFail(errors: ErrorDef): (code: string, data?: unknown) => never {
  return (code: string, data?: unknown): never => {
    const def = errors[code];
    const status = typeof def === "number" ? def : def?.status ?? 500;
    const message = typeof def === "object" && def !== null && "message" in def
      ? (def as { message?: string }).message
      : undefined;
    throw new KatmanError(code, { status, message, data, defined: true });
  };
}

function noopFail(code: string, data?: unknown): never {
  throw new KatmanError(code, { data, defined: false });
}

// ── Guard Application (inline, no closure) ──────────

/** Apply a single guard result to context */
function applyGuardResult(ctx: Record<string, unknown>, result: unknown): void {
  if (isPlainObject(result)) Object.assign(ctx, result);
}

/** Apply a single guard (sync fast-path, async fallback) */
async function applyGuard(ctx: Record<string, unknown>, guard: GuardDef): Promise<void> {
  const result = guard.fn(ctx);
  applyGuardResult(ctx, isThenable(result) ? await result : result);
}

// ── UNROLLED GUARD RUNNERS ──────────────────────────
// V8 Maglev can inline these because:
// - No loop → fixed call count
// - Each guard.fn is a direct reference
// - TurboFan can specialize per call site

function runGuards0(): Promise<void> | void {
  // noop — zero overhead
}

function runGuards1(ctx: Record<string, unknown>, g0: GuardDef): Promise<void> | void {
  const r0 = g0.fn(ctx);
  if (isThenable(r0)) return (r0 as Promise<unknown>).then(v => applyGuardResult(ctx, v));
  applyGuardResult(ctx, r0);
}

function runGuards2(ctx: Record<string, unknown>, g0: GuardDef, g1: GuardDef): Promise<void> | void {
  const r0 = g0.fn(ctx);
  if (isThenable(r0)) {
    return (r0 as Promise<unknown>).then(v => {
      applyGuardResult(ctx, v);
      return applyGuard(ctx, g1);
    });
  }
  applyGuardResult(ctx, r0);
  const r1 = g1.fn(ctx);
  if (isThenable(r1)) return (r1 as Promise<unknown>).then(v => applyGuardResult(ctx, v));
  applyGuardResult(ctx, r1);
}

function runGuards3(
  ctx: Record<string, unknown>, g0: GuardDef, g1: GuardDef, g2: GuardDef,
): Promise<void> | void {
  const r0 = g0.fn(ctx);
  if (isThenable(r0)) {
    return (r0 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v);
      await applyGuard(ctx, g1);
      await applyGuard(ctx, g2);
    });
  }
  applyGuardResult(ctx, r0);
  const r1 = g1.fn(ctx);
  if (isThenable(r1)) {
    return (r1 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v);
      await applyGuard(ctx, g2);
    });
  }
  applyGuardResult(ctx, r1);
  const r2 = g2.fn(ctx);
  if (isThenable(r2)) return (r2 as Promise<unknown>).then(v => applyGuardResult(ctx, v));
  applyGuardResult(ctx, r2);
}

function runGuards4(
  ctx: Record<string, unknown>, g0: GuardDef, g1: GuardDef, g2: GuardDef, g3: GuardDef,
): Promise<void> | void {
  const r0 = g0.fn(ctx);
  if (isThenable(r0)) {
    return (r0 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v);
      await applyGuard(ctx, g1);
      await applyGuard(ctx, g2);
      await applyGuard(ctx, g3);
    });
  }
  applyGuardResult(ctx, r0);
  const r1 = g1.fn(ctx);
  if (isThenable(r1)) {
    return (r1 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v);
      await applyGuard(ctx, g2);
      await applyGuard(ctx, g3);
    });
  }
  applyGuardResult(ctx, r1);
  const r2 = g2.fn(ctx);
  if (isThenable(r2)) {
    return (r2 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v);
      await applyGuard(ctx, g3);
    });
  }
  applyGuardResult(ctx, r2);
  const r3 = g3.fn(ctx);
  if (isThenable(r3)) return (r3 as Promise<unknown>).then(v => applyGuardResult(ctx, v));
  applyGuardResult(ctx, r3);
}

/** Fallback for 5+ guards — loop */
async function runGuardsN(ctx: Record<string, unknown>, guards: readonly GuardDef[]): Promise<void> {
  for (const guard of guards) {
    const result = guard.fn(ctx);
    applyGuardResult(ctx, isThenable(result) ? await result : result);
  }
}

/**
 * Select the optimal guard runner based on count.
 * Returns a function that applies all guards to a context.
 */
function selectGuardRunner(guards: readonly GuardDef[]): (ctx: Record<string, unknown>) => Promise<void> | void {
  switch (guards.length) {
    case 0: return runGuards0;
    case 1: return (ctx) => runGuards1(ctx, guards[0]!);
    case 2: return (ctx) => runGuards2(ctx, guards[0]!, guards[1]!);
    case 3: return (ctx) => runGuards3(ctx, guards[0]!, guards[1]!, guards[2]!);
    case 4: return (ctx) => runGuards4(ctx, guards[0]!, guards[1]!, guards[2]!, guards[3]!);
    default: return (ctx) => runGuardsN(ctx, guards);
  }
}

// ── Main Compiler ───────────────────────────────────

/**
 * Compile a procedure into the fastest possible handler.
 *
 * Optimizations applied:
 * - Guard count specialization (unrolled for 0-4)
 * - Separate fast path for no-wrap case (zero closures per request)
 * - Pre-computed fail function (singleton per procedure)
 * - Sync fast path when all guards are sync
 */
export function compileProcedure(procedure: ProcedureDef): CompiledHandler {
  const middlewares = procedure.use ?? [];
  const guards: GuardDef[] = [];
  const wraps: WrapDef[] = [];

  for (const mw of middlewares) {
    if (mw.kind === "guard") guards.push(mw);
    else wraps.push(mw);
  }

  const inputSchema = procedure.input;
  const outputSchema = procedure.output;
  const resolveFn = procedure.resolve;
  const failFn = procedure.errors ? createFail(procedure.errors) : noopFail;

  // Pre-select the optimal guard runner (compiled once, used per-request)
  const runGuards = selectGuardRunner(guards);

  // ── Fast path: no wraps (most common) ────────────
  if (wraps.length === 0) {
    return async (ctx, rawInput, signal) => {
      // Guards — unrolled, zero closures
      const guardResult = runGuards(ctx);
      if (guardResult) await guardResult; // only await if async

      // Validate input
      const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput;

      // Execute
      const output = await resolveFn({ input, ctx, fail: failFn, signal });

      // Validate output
      return outputSchema ? await validateSchema(outputSchema, output) : output;
    };
  }

  // ── Wrap path: build onion only for wraps ────────
  return async (ctx, rawInput, signal) => {
    // Guards — unrolled
    const guardResult = runGuards(ctx);
    if (guardResult) await guardResult;

    // Validate input
    const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput;

    // Build wrap onion (closures only for wraps count, not total middleware)
    let execute: () => Promise<unknown> = () =>
      Promise.resolve(resolveFn({ input, ctx, fail: failFn, signal }));

    for (let i = wraps.length - 1; i >= 0; i--) {
      const wrapFn = wraps[i]!.fn;
      const next = execute;
      execute = () => wrapFn(ctx, next);
    }

    const output = await execute();
    return outputSchema ? await validateSchema(outputSchema, output) : output;
  };
}

// ── FLAT MAP ROUTER ─────────────────────────────────

export type FlatRouter = Map<string, CompiledHandler>;

/**
 * Compile a router tree into a flat Map for O(1) lookup.
 *
 * Instead of:  traverse tree per request O(depth)
 * Now:         Map.get(path) per request O(1)
 */
export function compileRouter(def: Record<string, unknown>): FlatRouter {
  const map: FlatRouter = new Map();

  function walk(node: unknown, path: string[]): void {
    if (isProcedureDef(node)) {
      const key = path.join("/");
      map.set(key, compileProcedure(node as ProcedureDef));
      return;
    }
    if (typeof node === "object" && node !== null) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...path, k]);
      }
    }
  }

  walk(def, []);
  return map;
}

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "resolve" in value &&
    typeof (value as ProcedureDef).resolve === "function"
  );
}

// ── CONTEXT POOL ────────────────────────────────────

const POOL_SIZE = 256;

/**
 * Pre-allocated context pool — zero allocation on borrow.
 *
 * Each context is a null-prototype object (no prototype chain lookups).
 * After use, all properties are deleted and returned to pool.
 */
export class ContextPool {
  #pool: Record<string, unknown>[];
  #index = 0;

  constructor(size = POOL_SIZE) {
    this.#pool = Array.from({ length: size }, () => Object.create(null));
  }

  borrow(): Record<string, unknown> {
    if (this.#index < this.#pool.length) {
      return this.#pool[this.#index++]!;
    }
    // Pool exhausted — create new (fallback)
    return Object.create(null);
  }

  release(ctx: Record<string, unknown>): void {
    // Clear all properties
    for (const key of Object.keys(ctx)) {
      delete ctx[key];
    }
    if (this.#index > 0) {
      this.#pool[--this.#index] = ctx;
    }
  }
}
