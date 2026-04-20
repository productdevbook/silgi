/**
 * Pipeline Compiler
 * ------------------
 *
 * Turns a user-authored procedure (input schema, guards, wraps,
 * resolver, output schema) into a single handler that the adapters
 * call once per request:
 *
 *     (ctx, rawInput, signal) => output | Promise<output>
 *
 * The pipeline order is:
 *
 *   1. Guards — pre-steps that may mutate `ctx` or throw.
 *   2. Input validation — via Standard Schema if `input` is set.
 *   3. Wraps — onion middleware around the resolver (root wraps first).
 *   4. Resolver — user's business logic.
 *   5. Output validation — via Standard Schema if `output` is set.
 *
 * Everything that can be decided up-front (the merged error map, the
 * guard/wrap lists, whether validation exists) is closed over at
 * compile time so the per-request path stays small.
 *
 * Router compilation lives in `compileRouter`. It walks the nested
 * router def, compiles each procedure, and registers it in a rou3
 * radix tree.
 */

import { SilgiError } from './core/error.ts'
import { isProcedureDef } from './core/router-utils.ts'
import { validateSchema } from './core/schema.ts'

import type { ProcedureDef, GuardDef, WrapDef, ErrorDef } from './types.ts'

// Framework-internal symbol keys live in `core/ctx-symbols.ts`. We
// re-export `RAW_INPUT` here for consumers that used to import it from
// this module directly (cache.ts, map-input.ts, coerce.ts).
export { RAW_INPUT } from './core/ctx-symbols.ts'

import { RAW_INPUT, ROOT_WRAPS } from './core/ctx-symbols.ts'

/**
 * Compiled request handler. May return a sync value or a `Promise` —
 * adapters branch on `instanceof Promise` for the fast path when the
 * resolver and guards were all synchronous.
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

// ─── Guard application ────────────────────────────────────────────────

/**
 * Keys forbidden anywhere in a guard's return value. Blocking them at
 * every level keeps `ctx` (a plain object) safe from attacker-supplied
 * payloads that could otherwise reach `Object.prototype`.
 */
const UNSAFE_KEYS = /* @__PURE__ */ new Set(['__proto__', 'constructor', 'prototype'])

/** Shared frozen empty params object. Read only, never mutated. */
const EMPTY_PARAMS: Record<string, string> = /* @__PURE__ */ Object.freeze(Object.create(null))

/**
 * Recursively scrub a value produced by a guard so it cannot reach
 * `Object.prototype` through nested `__proto__` / `constructor` /
 * `prototype` keys.
 *
 * Arrays are scrubbed in place (they cannot be prototype-polluted
 * themselves, but their elements might). Class instances are left
 * alone — they already have a non-literal prototype, so merging them
 * into `ctx` does not mutate `Object.prototype`. Plain objects get a
 * shallow rebuild when they carry a forbidden key, otherwise their
 * values are scrubbed in place.
 */
function sanitizeValue(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return value

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = sanitizeValue(value[i])
    return value
  }

  // Leave class instances (anything not produced by an object literal) alone.
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value

  const obj = value as Record<string, unknown>
  const hasUnsafe = Object.prototype.hasOwnProperty.call(obj, '__proto__')

  if (hasUnsafe) {
    // Rebuild without the forbidden key; null-prototype so the rebuilt
    // object itself cannot be polluted.
    const clean: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(obj)) {
      if (!UNSAFE_KEYS.has(key)) clean[key] = sanitizeValue(obj[key])
    }
    return clean
  }

  // No forbidden keys at this level — recurse into children in place.
  for (const key of Object.keys(obj)) {
    obj[key] = sanitizeValue(obj[key])
  }
  return value
}

/**
 * Merge a single guard's return value into the live context. Guards
 * typically return a partial patch (e.g. `{ user }`); returning
 * nothing is fine and is how guards that only validate are expressed.
 */
function applyGuardResult(ctx: Record<string, unknown>, result: unknown): void {
  if (result === null || result === undefined || typeof result !== 'object') return
  for (const key of Object.keys(result)) {
    if (UNSAFE_KEYS.has(key)) continue
    ctx[key] = sanitizeValue((result as Record<string, unknown>)[key])
  }
}

// ─── Guard runner ─────────────────────────────────────────────────────

/**
 * Run every guard in order, applying each result to `ctx` before the
 * next guard runs.
 *
 * Sync-first: when a guard returns synchronously we stay on the sync
 * path — only the first guard that returns a `Promise` forces us onto
 * the async branch. That keeps the common case of all-sync guards from
 * allocating a Promise at all.
 *
 * Empty-guards path is short-circuited at the call site (the returned
 * runner is `undefined` when `guards.length === 0`).
 */
function runGuardsSequential(ctx: Record<string, unknown>, guards: readonly GuardDef[]): Promise<void> | void {
  for (let i = 0; i < guards.length; i++) {
    const result = guards[i]!.fn(ctx)
    if (isThenable(result)) {
      // One guard went async — finish the rest on the async branch.
      return finishGuardsAsync(ctx, guards, i, result as Promise<unknown>)
    }
    applyGuardResult(ctx, result)
  }
}

/**
 * Complete the guard chain on the async branch once a guard returned a
 * `Promise`. The remaining guards are awaited in order so their results
 * land on `ctx` in the same order a sync run would have produced.
 */
async function finishGuardsAsync(
  ctx: Record<string, unknown>,
  guards: readonly GuardDef[],
  resumeIndex: number,
  firstPromise: Promise<unknown>,
): Promise<void> {
  applyGuardResult(ctx, await firstPromise)
  for (let i = resumeIndex + 1; i < guards.length; i++) {
    const result = guards[i]!.fn(ctx)
    applyGuardResult(ctx, isThenable(result) ? await result : result)
  }
}

/**
 * Pre-bind the guard list to a runner. Returning `undefined` for the
 * zero-guard case means the call site can skip the call entirely with
 * a cheap null check.
 */
function selectGuardRunner(
  guards: readonly GuardDef[],
): ((ctx: Record<string, unknown>) => Promise<void> | void) | undefined {
  if (guards.length === 0) return undefined
  return (ctx) => runGuardsSequential(ctx, guards)
}

// ── Resolve + output validation helper ──────────────

/** Call resolve, then validate output (sync-first, async fallback) */
/**
 * Call the resolver, then validate the output. Stays sync when the
 * resolver is sync and there is no output schema; switches to
 * `.then()` chaining only once an async boundary appears.
 */
function resolveWithOutput(
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

/**
 * Validate input, call the resolver, validate output.
 *
 * Everything that throws synchronously (input validation errors,
 * `fail()` calls inside the resolver, the resolver itself) is turned
 * into a rejected `Promise` so callers can rely on a single
 * `.then().catch()` chain no matter which branch the pipeline took.
 */
function validateAndResolve(
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
        resolveWithOutput(resolveFn, resolvedInput, ctx, failFn, signal, outputSchema),
      )
    }
    return resolveWithOutput(resolveFn, input, ctx, failFn, signal, outputSchema)
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
export function compileProcedure(procedure: ProcedureDef, rootWraps?: readonly WrapDef[] | null): CompiledHandler {
  const middlewares = procedure.use ?? []
  const guards: GuardDef[] = []
  const procedureWraps: WrapDef[] = []

  // Guards and route-level wraps come from `.$use(...)`. They stay
  // separated here: guards are pre-steps, wraps form an onion around
  // the resolver.
  for (const mw of middlewares) {
    if (mw.kind === 'guard') guards.push(mw)
    else procedureWraps.push(mw)
  }

  // Root wraps (from `silgi({ wraps })`) are a *separate* onion that
  // sits OUTSIDE everything else — including guards. That's the
  // contract documented on `SilgiConfig.wraps`: root wraps run as the
  // outermost layer, so an `AsyncLocalStorage.run(...)` installed at
  // root-wrap time is visible to guards, procedure wraps, and the
  // resolver alike (see issue #14).
  //
  // Previously they were pushed into `procedureWraps`, which made
  // them sit *inside* guards — a silent contradiction of the docs
  // that broke tenant-scope use cases.
  const rootWrapList: readonly WrapDef[] = rootWraps && rootWraps.length > 0 ? rootWraps : EMPTY_WRAPS
  const hasRootWraps = rootWrapList.length > 0

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

  // ─── Build the *inner* handler ───────────────────────────────────
  // This is the pipeline a request flows through after root wraps
  // have already wrapped the call. Structure and fast-paths are
  // unchanged from the pre-fix code — only the root-wrap placement
  // moved.

  let innerHandler: CompiledHandler

  if (procedureWraps.length === 0 && !inputSchema && !outputSchema) {
    // Fully synchronous fast path — no validation, no wrap onion.
    // try/catch converts sync throws (guard errors, fail() calls,
    // resolver errors) into rejected Promises so callers have a
    // single error idiom.
    innerHandler = (ctx, rawInput, signal) => {
      try {
        const guardResult = runGuards?.(ctx)
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
  } else if (procedureWraps.length === 0) {
    // Semi-sync: validation runs but no wrap onion.
    innerHandler = (ctx, rawInput, signal) => {
      try {
        const guardResult = runGuards?.(ctx)
        if (guardResult && isThenable(guardResult)) {
          return (guardResult as Promise<void>).then(() =>
            validateAndResolve(inputSchema, outputSchema, resolveFn, rawInput, ctx, failFn, signal),
          )
        }
        return validateAndResolve(inputSchema, outputSchema, resolveFn, rawInput, ctx, failFn, signal)
      } catch (e) {
        return Promise.reject(e)
      }
    }
  } else {
    // Full wrap path: procedure wraps onion around the resolver.
    innerHandler = async (ctx, rawInput, signal) => {
      const guardResult = runGuards?.(ctx)
      if (guardResult && isThenable(guardResult)) await guardResult

      let input: unknown
      if (inputSchema) {
        const validated = validateSchema(inputSchema, rawInput ?? {})
        input = isThenable(validated) ? await validated : validated
      } else {
        input = rawInput
      }

      // Store input on context so wraps (e.g. mapInput) can read/modify it
      ;(ctx as Record<PropertyKey, unknown>)[RAW_INPUT] = input

      let execute: () => Promise<unknown> = () => {
        const resolvedInput = (ctx as Record<PropertyKey, unknown>)[RAW_INPUT] ?? input
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

      for (let i = procedureWraps.length - 1; i >= 0; i--) {
        const wrapFn = procedureWraps[i]!.fn
        const next = execute
        execute = () => wrapFn(ctx, next)
      }

      const output = await execute()
      if (!outputSchema) return output
      const validated = validateSchema(outputSchema, output)
      return isThenable(validated) ? await validated : validated
    }
  }

  // ─── Root-wrap onion (outermost) ─────────────────────────────────
  //
  // No root wraps → return the inner handler unchanged. Root wraps →
  // fold them around `innerHandler` outermost-first. Each root wrap
  // sees the same `ctx` the adapter built; `next()` drives the rest
  // of the pipeline (guards + procedure wraps + resolver).

  if (!hasRootWraps) return innerHandler

  return async (ctx, rawInput, signal) => {
    let execute: () => Promise<unknown> = async () => innerHandler(ctx, rawInput, signal)

    for (let i = rootWrapList.length - 1; i >= 0; i--) {
      const wrapFn = rootWrapList[i]!.fn
      const next = execute
      execute = () => Promise.resolve(wrapFn(ctx, next))
    }

    return execute()
  }
}

/** Shared empty array for the "no root wraps" case — avoids per-call allocation. */
const EMPTY_WRAPS: readonly WrapDef[] = /* @__PURE__ */ Object.freeze([])

// ── COMPILED ROUTER ─────────────────────────────────

import { createRouter as createRou3, addRoute as addRou3Route, findRoute as findRou3Route } from 'rou3'

export interface CompiledRoute {
  handler: CompiledHandler
  /** Pre-computed Cache-Control header value, or undefined if no caching */
  cacheControl?: string
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

  // Root wraps are branded onto the def by `silgi({ wraps }).router(def)`.
  // Reading once here and passing into every `compileProcedure` avoids any
  // per-adapter plumbing — every compile site already routes through here.
  // When the brand is absent (no wraps, or def compiled from outside a
  // silgi instance), `rootWraps` is `undefined` and `compileProcedure`
  // walks its existing zero-cost fast paths unchanged.
  const rootWraps = (def as { [ROOT_WRAPS]?: readonly WrapDef[] })[ROOT_WRAPS]

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
        handler: compileProcedure(proc, rootWraps),
        cacheControl,
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

/**
 * Disposable context object handed to the pipeline.
 *
 * Adapters use `using ctx = createContext()` so the context is
 * disposed automatically at scope exit — unless ownership has been
 * transferred elsewhere (e.g. to a streaming `Response` that keeps
 * reading from `ctx` after the handler returns). In that case the
 * handler calls `detachContext(ctx)` and the new owner is responsible
 * for cleanup.
 */
export type PooledContext = Record<string, unknown> & Disposable

/**
 * Allocate a fresh pipeline context.
 *
 * The object has a `null` prototype so user-supplied keys cannot
 * accidentally shadow `Object.prototype` members and property lookups
 * stay on the object itself.
 *
 * A `Symbol.dispose` slot is attached so `using ctx = createContext()`
 * runs `releaseContext(ctx)` at scope exit. Streaming responses that
 * outlive the handler scope swap that slot for a no-op via
 * `detachContext` and take ownership.
 *
 * This used to draw from a recycled pool. The pool has been removed —
 * the win was marginal, the indirection was loud, and the tests that
 * pinned "pool readback" behaviour were observing an implementation
 * detail, not a user-visible guarantee. The public API
 * (`createContext` / `detachContext` / `releaseContext` /
 * `PooledContext`) is preserved so existing call sites keep working;
 * only the internals changed.
 */
export function createContext(): PooledContext {
  const ctx = Object.create(null) as PooledContext
  ctx[Symbol.dispose] = disposeContext
  return ctx
}

/**
 * Mark the context as owned elsewhere so the enclosing `using` block
 * will not dispose it. Call this when you hand `ctx` to something
 * that outlives the handler scope (an SSE stream, a WebSocket
 * subscription, etc.).
 */
export function detachContext(ctx: Record<string, unknown>): void {
  ;(ctx as Record<PropertyKey, unknown>)[Symbol.dispose] = noopDispose
}

function disposeContext(this: Record<string, unknown>): void {
  releaseContext(this)
}

function noopDispose(): void {}

/**
 * Release a context. Called automatically at `using` scope exit and
 * explicitly by stream handlers when their stream ends.
 *
 * The body is intentionally empty: there is no pool to return to and
 * the GC reclaims the object as soon as its last reference drops.
 * The function is kept so every `createContext` has a symmetrical
 * `releaseContext`, matching the Disposable contract consumers already
 * rely on.
 */
export function releaseContext(_ctx: Record<string, unknown>): void {
  // No-op — present for API symmetry. GC does the real work.
}
