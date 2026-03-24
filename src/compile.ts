/**
 * Pipeline Compiler — guard unrolling, context pooling, rou3 routing.
 *
 * 1. UNROLLED GUARDS — 0-4 guard specialization (no loop, V8 inlines)
 * 2. ZERO-ALLOC CONTEXT — Object.create(null) + pool reuse
 * 3. ROU3 ROUTER — unjs radix tree (same as h3/nitro)
 */

import { SilgiError } from './core/error.ts'
import { isProcedureDef } from './core/router-utils.ts'
import { validateSchema } from './core/schema.ts'

import type { ProcedureDef, GuardDef, WrapDef, ErrorDef } from './types.ts'

/** Internal symbol for pipeline raw input — prevents collision with user context keys */
export const RAW_INPUT = Symbol.for('silgi.rawInput')

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

/** Pre-frozen empty params — avoids per-request {} allocation */
const EMPTY_PARAMS: Record<string, string> = /* @__PURE__ */ Object.freeze(Object.create(null))

/** Sanitize a value to prevent prototype pollution from nested __proto__ keys */
function sanitizeValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value
  // Only sanitize plain objects — class instances, arrays, etc. are safe
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  if (Array.isArray(value)) return value

  const obj = value as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(obj, '__proto__')) return value

  // Has __proto__ key — create a clean copy without it
  const clean: Record<string, unknown> = Object.create(null)
  const keys = Object.keys(obj)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    if (k !== '__proto__') clean[k] = obj[k]
  }
  return clean
}

/** Apply a single guard result to context — direct property set */
function applyGuardResult(ctx: Record<string, unknown>, result: unknown): void {
  if (result === null || result === undefined || typeof result !== 'object') return
  const keys = Object.keys(result)
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i]!
    if (UNSAFE_KEYS.has(k)) continue
    ctx[k] = sanitizeValue((result as Record<string, unknown>)[k])
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

// ── Resolve + output validation helper ──────────────

/** Call resolve, then validate output (sync-first, async fallback) */
function _resolveWithOutput(
  resolveFn: Function,
  input: unknown,
  ctx: Record<string, unknown>,
  failFn: (code: string, data?: unknown) => never,
  signal: AbortSignal,
  outputSchema: import('./core/schema.ts').AnySchema | null,
): unknown {
  const output = resolveFn({
    input,
    ctx,
    fail: failFn,
    signal,
    params: (ctx.params ?? EMPTY_PARAMS) as Record<string, string>,
  })
  if (!outputSchema) return output
  if (isThenable(output)) {
    return (output as Promise<unknown>).then((o) => validateSchema(outputSchema, o))
  }
  return validateSchema(outputSchema, output)
}

/** Validate input, resolve, validate output — sync-first with rejected Promise fallback.
 *  All sync throws (validation errors, fail() calls, resolver errors) are converted
 *  to rejected Promises for consistent error handling in .then().catch() chains. */
function _validateAndResolve(
  inputSchema: import('./core/schema.ts').AnySchema | null,
  outputSchema: import('./core/schema.ts').AnySchema | null,
  resolveFn: Function,
  rawInput: unknown,
  ctx: Record<string, unknown>,
  failFn: (code: string, data?: unknown) => never,
  signal: AbortSignal,
): unknown {
  try {
    const input = inputSchema ? validateSchema(inputSchema, rawInput ?? {}) : rawInput
    if (isThenable(input)) {
      return (input as Promise<unknown>).then((resolvedInput) =>
        _resolveWithOutput(resolveFn, resolvedInput, ctx, failFn, signal, outputSchema),
      )
    }
    return _resolveWithOutput(resolveFn, input, ctx, failFn, signal, outputSchema)
  } catch (e) {
    return Promise.reject(e)
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

  // Pre-compute fail function — use typed errors when defined, noop otherwise
  const failFn = mergedErrors ? createFail(mergedErrors) : noopFail

  // Pre-select the optimal guard runner (compiled once, used per-request)
  const runGuards = selectGuardRunner(guards)

  // ── SYNC FAST PATH: no wraps, no validation ──
  // try/catch converts sync throws (guard errors, fail() calls, resolver errors)
  // to rejected Promises for consistent error handling across all paths.
  if (wraps.length === 0 && !inputSchema && !outputSchema) {
    return (ctx, rawInput, signal) => {
      try {
        const guardResult = runGuards(ctx)
        if (guardResult && isThenable(guardResult)) {
          return (guardResult as Promise<void>).then(() =>
            resolveFn({
              input: rawInput,
              ctx,
              fail: failFn,
              signal,
              params: (ctx.params ?? EMPTY_PARAMS) as Record<string, string>,
            }),
          )
        }
        return resolveFn({
          input: rawInput,
          ctx,
          fail: failFn,
          signal,
          params: (ctx.params ?? EMPTY_PARAMS) as Record<string, string>,
        })
      } catch (e) {
        return Promise.reject(e)
      }
    }
  }

  // ── SEMI-SYNC: no wraps, has validation ────────────
  // All sync throws (guards, validation, resolve) converted to rejected Promises.
  if (wraps.length === 0) {
    return (ctx, rawInput, signal) => {
      try {
        const guardResult = runGuards(ctx)
        if (guardResult && isThenable(guardResult)) {
          return (guardResult as Promise<void>).then(() =>
            _validateAndResolve(inputSchema, outputSchema, resolveFn, rawInput, ctx, failFn, signal),
          )
        }
        return _validateAndResolve(inputSchema, outputSchema, resolveFn, rawInput, ctx, failFn, signal)
      } catch (e) {
        return Promise.reject(e)
      }
    }
  }

  // ── WRAP PATH: onion only for wraps ────────────────
  // Wraps always need async (onion model requires chained next() calls)
  return async (ctx, rawInput, signal) => {
    const guardResult = runGuards(ctx)
    if (guardResult && isThenable(guardResult)) await guardResult

    let input: unknown
    if (inputSchema) {
      const validated = validateSchema(inputSchema, rawInput ?? {})
      input = isThenable(validated) ? await validated : validated
    } else {
      input = rawInput
    }

    // Store input on context so wraps (e.g. mapInput) can read/modify it
    ;(ctx as any)[RAW_INPUT] = input

    let execute: () => Promise<unknown> = () => {
      const resolvedInput = (ctx as any)[RAW_INPUT] ?? input
      return Promise.resolve(
        resolveFn({
          input: resolvedInput,
          ctx,
          fail: failFn,
          signal,
          params: (ctx.params ?? EMPTY_PARAMS) as Record<string, string>,
        }),
      )
    }

    for (let i = wraps.length - 1; i >= 0; i--) {
      const wrapFn = wraps[i]!.fn
      const next = execute
      execute = () => wrapFn(ctx, next)
    }

    const output = await execute()
    if (!outputSchema) return output
    const validated = validateSchema(outputSchema, output)
    return isThenable(validated) ? await validated : validated
  }
}

// ── COMPILED ROUTER ─────────────────────────────────

import { createRouter as createRou3, addRoute as addRou3Route, findRoute as findRou3Route } from 'rou3'

export interface CompiledRoute {
  handler: CompiledHandler
  /** Pre-computed Cache-Control header value, or undefined if no caching */
  cacheControl?: string
  /** Procedure is accessible over WebSocket */
  ws?: boolean
  /** Skip body parsing — procedure receives raw request (e.g. catch-all proxy) */
  passthrough?: boolean
  /** HTTP method this route is registered for (uppercase) */
  method: string
}

/** Match result from the router */
export interface MatchedRoute<T = unknown> {
  data: T
  params?: Record<string, string>
}

/** Compiled router function — returns matched route + params */
export type CompiledRouterFn = (method: string, path: string) => MatchedRoute<CompiledRoute> | undefined

/**
 * Compile a router tree into a rou3 radix router.
 *
 * Powered by rou3 (unjs) — battle-tested, fast, minimal.
 */
export function compileRouter(def: Record<string, unknown>): CompiledRouterFn {
  const router = createRou3<CompiledRoute>()

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

      const compiled: CompiledRoute = {
        handler: compileProcedure(proc),
        cacheControl,
        ws: route?.ws ?? undefined,
        passthrough: routePath.includes('**') || undefined,
        method,
      }

      addRou3Route(router, method, routePath, compiled)

      // Also add empty method for internal callers (createCaller uses '' method)
      addRou3Route(router, '', routePath, compiled)

      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [k, v] of Object.entries(node)) {
        walk(v, [...path, k])
      }
    }
  }

  walk(def, [])

  return (method: string, path: string) =>
    findRou3Route(router, method, path) as MatchedRoute<CompiledRoute> | undefined
}

/** Pool of pre-allocated null-prototype context objects — eliminates per-request GC pressure. */
const CTX_POOL: Record<string, unknown>[] = []
const CTX_POOL_MAX = 128

/** Acquire a context object from the pool (or create one). */
export function createContext(): Record<string, unknown> {
  return CTX_POOL.length > 0 ? CTX_POOL.pop()! : Object.create(null)
}

/** Return a context object to the pool after request completes. */
export function releaseContext(ctx: Record<string, unknown>): void {
  // Wipe all properties so the next request starts clean
  for (const key of Object.keys(ctx)) delete ctx[key]
  for (const sym of Object.getOwnPropertySymbols(ctx)) delete (ctx as any)[sym]
  if (CTX_POOL.length < CTX_POOL_MAX) CTX_POOL.push(ctx)
}
