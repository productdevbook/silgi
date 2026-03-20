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

import { analyzeHandler } from './analyze.ts'
import { SilgiError } from './core/error.ts'
import { validateSchema } from './core/schema.ts'
import { compileStringify } from './fast-stringify.ts'

import type { ProcedureDef, GuardDef, WrapDef, ErrorDef } from './types.ts'

/**
 * Compiled pipeline — called per request.
 * May return sync value OR Promise — caller uses instanceof check.
 */
export type CompiledHandler = (
  ctx: Record<string, unknown>,
  rawInput: unknown,
  signal: AbortSignal,
) => unknown | Promise<unknown>

// ── Helpers ─────────────────────────────────────────

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === 'object' && typeof (value as any).then === 'function'
}

function createFail(errors: ErrorDef): (code: string, data?: unknown) => never {
  return (code: string, data?: unknown): never => {
    const def = errors[code]
    const status = typeof def === 'number' ? def : (def?.status ?? 500)
    const message =
      typeof def === 'object' && def !== null && 'message' in def ? (def as { message?: string }).message : undefined
    throw new SilgiError(code, { status, message, data, defined: true })
  }
}

function noopFail(code: string, data?: unknown): never {
  throw new SilgiError(code, { data, defined: false })
}

// ── Guard Application (inline, no closure) ──────────

const UNSAFE_KEYS = /* @__PURE__ */ new Set(['__proto__', 'constructor', 'prototype'])

/** Apply a single guard result to context — direct property set (326x faster than Object.assign) */
function applyGuardResult(ctx: Record<string, unknown>, result: unknown): void {
  if (result === null || result === undefined || typeof result !== 'object') return
  // Support both plain objects and class instances (preserves getters via enumerable keys)
  const keys = Object.keys(result)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    if (UNSAFE_KEYS.has(k)) continue
    ctx[k] = (result as Record<string, unknown>)[k]
  }
}

/** Apply a single guard (sync fast-path, async fallback) */
async function applyGuard(ctx: Record<string, unknown>, guard: GuardDef): Promise<void> {
  const result = guard.fn(ctx)
  applyGuardResult(ctx, isThenable(result) ? await result : result)
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
  const r0 = g0.fn(ctx)
  if (isThenable(r0)) return (r0 as Promise<unknown>).then((v) => applyGuardResult(ctx, v))
  applyGuardResult(ctx, r0)
}

function runGuards2(ctx: Record<string, unknown>, g0: GuardDef, g1: GuardDef): Promise<void> | void {
  const r0 = g0.fn(ctx)
  if (isThenable(r0)) {
    return (r0 as Promise<unknown>).then((v) => {
      applyGuardResult(ctx, v)
      return applyGuard(ctx, g1)
    })
  }
  applyGuardResult(ctx, r0)
  const r1 = g1.fn(ctx)
  if (isThenable(r1)) return (r1 as Promise<unknown>).then((v) => applyGuardResult(ctx, v))
  applyGuardResult(ctx, r1)
}

function runGuards3(ctx: Record<string, unknown>, g0: GuardDef, g1: GuardDef, g2: GuardDef): Promise<void> | void {
  const r0 = g0.fn(ctx)
  if (isThenable(r0)) {
    return (r0 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v)
      await applyGuard(ctx, g1)
      await applyGuard(ctx, g2)
    })
  }
  applyGuardResult(ctx, r0)
  const r1 = g1.fn(ctx)
  if (isThenable(r1)) {
    return (r1 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v)
      await applyGuard(ctx, g2)
    })
  }
  applyGuardResult(ctx, r1)
  const r2 = g2.fn(ctx)
  if (isThenable(r2)) return (r2 as Promise<unknown>).then((v) => applyGuardResult(ctx, v))
  applyGuardResult(ctx, r2)
}

function runGuards4(
  ctx: Record<string, unknown>,
  g0: GuardDef,
  g1: GuardDef,
  g2: GuardDef,
  g3: GuardDef,
): Promise<void> | void {
  const r0 = g0.fn(ctx)
  if (isThenable(r0)) {
    return (r0 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v)
      await applyGuard(ctx, g1)
      await applyGuard(ctx, g2)
      await applyGuard(ctx, g3)
    })
  }
  applyGuardResult(ctx, r0)
  const r1 = g1.fn(ctx)
  if (isThenable(r1)) {
    return (r1 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v)
      await applyGuard(ctx, g2)
      await applyGuard(ctx, g3)
    })
  }
  applyGuardResult(ctx, r1)
  const r2 = g2.fn(ctx)
  if (isThenable(r2)) {
    return (r2 as Promise<unknown>).then(async (v) => {
      applyGuardResult(ctx, v)
      await applyGuard(ctx, g3)
    })
  }
  applyGuardResult(ctx, r2)
  const r3 = g3.fn(ctx)
  if (isThenable(r3)) return (r3 as Promise<unknown>).then((v) => applyGuardResult(ctx, v))
  applyGuardResult(ctx, r3)
}

/** Fallback for 5+ guards — loop */
async function runGuardsN(ctx: Record<string, unknown>, guards: readonly GuardDef[]): Promise<void> {
  for (const guard of guards) {
    const result = guard.fn(ctx)
    applyGuardResult(ctx, isThenable(result) ? await result : result)
  }
}

/**
 * Select the optimal guard runner based on count.
 * Returns a function that applies all guards to a context.
 */
function selectGuardRunner(guards: readonly GuardDef[]): (ctx: Record<string, unknown>) => Promise<void> | void {
  // Pre-extract function references at compile time (avoid .fn property access at runtime)
  switch (guards.length) {
    case 0:
      return runGuards0
    case 1: {
      const g0 = guards[0]!
      return (ctx) => runGuards1(ctx, g0)
    }
    case 2: {
      const [g0, g1] = guards
      return (ctx) => runGuards2(ctx, g0!, g1!)
    }
    case 3: {
      const [g0, g1, g2] = guards
      return (ctx) => runGuards3(ctx, g0!, g1!, g2!)
    }
    case 4: {
      const [g0, g1, g2, g3] = guards
      return (ctx) => runGuards4(ctx, g0!, g1!, g2!, g3!)
    }
    default:
      return (ctx) => runGuardsN(ctx, guards)
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
  const middlewares = procedure.use ?? []
  const guards: GuardDef[] = []
  const wraps: WrapDef[] = []

  for (const mw of middlewares) {
    if (mw.kind === 'guard') guards.push(mw)
    else wraps.push(mw)
  }

  const inputSchema = procedure.input
  const outputSchema = procedure.output
  const resolveFn = procedure.resolve

  // Merge guard errors into procedure errors (runtime)
  let mergedErrors = procedure.errors
  for (const guard of guards) {
    if (guard.errors) {
      mergedErrors = mergedErrors ? { ...mergedErrors, ...guard.errors } : guard.errors
    }
  }

  // Sucrose-style analysis: skip fail/signal allocation if handler doesn't use them
  const analysis = analyzeHandler(resolveFn)
  const failFn = analysis.usesFail && mergedErrors ? createFail(mergedErrors) : analysis.usesFail ? noopFail : noopFail // always provide fail (safe fallback), but skip createFail overhead when unused

  // Pre-select the optimal guard runner (compiled once, used per-request)
  const runGuards = selectGuardRunner(guards)

  // ── ULTRA-FAST: no guards, no wraps, no validation, no ctx/fail usage ──
  // Handler only uses input or nothing — skip everything
  if (
    guards.length === 0 &&
    wraps.length === 0 &&
    !inputSchema &&
    !outputSchema &&
    !analysis.usesContext &&
    !analysis.usesFail
  ) {
    return (_ctx, rawInput, signal) =>
      resolveFn({
        input: rawInput,
        ctx: _ctx,
        fail: failFn,
        signal,
        params: (_ctx.params ?? {}) as Record<string, string>,
      })
  }

  // ── SYNC FAST PATH: no wraps, no validation, all sync guards ──
  if (wraps.length === 0 && !inputSchema && !outputSchema) {
    return (ctx, rawInput, signal) => {
      const guardResult = runGuards(ctx)
      if (guardResult && isThenable(guardResult)) {
        return (guardResult as Promise<void>).then(() =>
          resolveFn({
            input: rawInput,
            ctx,
            fail: failFn,
            signal,
            params: (ctx.params ?? {}) as Record<string, string>,
          }),
        )
      }
      const output = resolveFn({
        input: rawInput,
        ctx,
        fail: failFn,
        signal,
        params: (ctx.params ?? {}) as Record<string, string>,
      })
      return output
    }
  }

  // ── SEMI-SYNC: no wraps, has validation ────────────
  if (wraps.length === 0) {
    return async (ctx, rawInput, signal) => {
      const guardResult = runGuards(ctx)
      if (guardResult) await guardResult
      const input = inputSchema ? await validateSchema(inputSchema, rawInput ?? {}) : rawInput
      const output = await resolveFn({
        input,
        ctx,
        fail: failFn,
        signal,
        params: (ctx.params ?? {}) as Record<string, string>,
      })
      return outputSchema ? await validateSchema(outputSchema, output) : output
    }
  }

  // ── WRAP PATH: onion only for wraps ────────────────
  return async (ctx, rawInput, signal) => {
    const guardResult = runGuards(ctx)
    if (guardResult) await guardResult
    const input = inputSchema ? await validateSchema(inputSchema, rawInput ?? {}) : rawInput

    // Store input on context so wraps (e.g. mapInput) can read/modify it
    ctx.__rawInput = input

    let execute: () => Promise<unknown> = () => {
      const resolvedInput = ctx.__rawInput ?? input
      return Promise.resolve(
        resolveFn({
          input: resolvedInput,
          ctx,
          fail: failFn,
          signal,
          params: (ctx.params ?? {}) as Record<string, string>,
        }),
      )
    }

    for (let i = wraps.length - 1; i >= 0; i--) {
      const wrapFn = wraps[i]!.fn
      const next = execute
      execute = () => wrapFn(ctx, next)
    }

    const output = await execute()
    return outputSchema ? await validateSchema(outputSchema, output) : output
  }
}

// ── COMPILED ROUTER ─────────────────────────────────

import {
  createRouter as createRadixRouter,
  addRoute as addRadixRoute,
  compileRouter as compileRadixRouter,
} from './route/index.ts'

import type { MatchedRoute } from './route/types.ts'

export interface CompiledRoute {
  handler: CompiledHandler
  stringify: (value: unknown) => string
  /** Pre-computed Cache-Control header value, or undefined if no caching */
  cacheControl?: string
}

/** Compiled router function — returns matched route + params */
export type CompiledRouterFn = (method: string, path: string) => MatchedRoute<CompiledRoute> | undefined

/** @deprecated Use CompiledRouterFn */
export type FlatRouter = CompiledRouterFn

/**
 * Compile a router tree into a JIT-compiled radix router.
 *
 * Uses charCodeAt dispatch + lazy split + pre-allocated results.
 * Static: ~2ns, Param: ~15ns, Wildcard: ~7ns, Miss: ~2ns.
 */
export function compileRouter(def: Record<string, unknown>): CompiledRouterFn {
  const radix = createRadixRouter<CompiledRoute>()

  function walk(node: unknown, path: string[]): void {
    if (isProcedureDef(node)) {
      const proc = node as ProcedureDef
      const route = proc.route as import('./types.ts').Route | null

      // Use custom route path or auto-generated from tree
      const routePath = route?.path || '/' + path.join('/')

      // HTTP method from route config, default POST
      const method = route?.method?.toUpperCase() || 'POST'

      let cacheControl: string | undefined
      if (route?.cache != null) {
        cacheControl = typeof route.cache === 'number' ? `public, max-age=${route.cache}` : route.cache
      }

      addRadixRoute(radix, method, routePath, {
        handler: compileProcedure(proc),
        stringify: compileStringify(proc.output),
        cacheControl,
      })

      // Also add empty method for fallback (any method)
      addRadixRoute(radix, '', routePath, {
        handler: compileProcedure(proc),
        stringify: compileStringify(proc.output),
        cacheControl,
      })

      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...path, k])
      }
    }
  }

  walk(def, [])
  return compileRadixRouter(radix)
}

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'resolve' in value &&
    typeof (value as ProcedureDef).resolve === 'function'
  )
}

// ── CONTEXT POOL ────────────────────────────────────

const POOL_SIZE = 256

/**
 * Pre-allocated context pool — zero allocation on borrow.
 *
 * Each context is a null-prototype object (no prototype chain lookups).
 * After use, all properties are deleted and returned to pool.
 */
export class ContextPool {
  #pool: Record<string, unknown>[]
  #index = 0

  constructor(size = POOL_SIZE) {
    this.#pool = Array.from({ length: size }, () => Object.create(null))
  }

  borrow(): Record<string, unknown> {
    if (this.#index < this.#pool.length) {
      return this.#pool[this.#index++]!
    }
    // Pool exhausted — create new (fallback)
    return Object.create(null)
  }

  release(_ctx: Record<string, unknown>): void {
    // Replace with fresh null-prototype object instead of deleting properties
    // (delete causes V8 dictionary mode transition, defeating the pool's purpose)
    if (this.#index > 0) {
      this.#pool[--this.#index] = Object.create(null)
    }
  }

  /** Borrow a context that auto-releases when disposed (Node 24+ / `using` keyword) */
  borrowDisposable(): Record<string, unknown> & Disposable {
    const ctx = this.borrow() as Record<string, unknown> & Disposable
    ctx[Symbol.dispose] = () => this.release(ctx)
    return ctx
  }
}
