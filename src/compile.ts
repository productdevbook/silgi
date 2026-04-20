/**
 * Pipeline Compiler
 * ------------------
 *
 * Takes a user-authored procedure (input schema, guards, wraps, resolver,
 * output schema) and produces a single async handler:
 *
 *     (ctx, rawInput, signal) => Promise<output>
 *
 * The pipeline runs in this order for every request:
 *
 *   1. Guards — pre-steps that may mutate `ctx` or throw.
 *   2. Input validation — via Standard Schema if `input` is set.
 *   3. Wraps — onion middleware around the resolver (root wraps first).
 *   4. Resolver — user's business logic.
 *   5. Output validation — via Standard Schema if `output` is set.
 *
 * The compiled handler is called per request, but everything that can be
 * decided up-front (the merged error map, the guard/wrap lists, whether
 * validation exists) is closed over here so the hot path is simple.
 *
 * Router compilation lives in `compileRouter` below. It walks the nested
 * router definition, compiles each procedure, and registers the result
 * with a rou3 radix tree.
 */

import { createRouter as createRou3, addRoute as addRou3Route, findRoute as findRou3Route } from 'rou3'

import { SilgiError } from './core/error.ts'
import { RAW_INPUT, ROOT_WRAPS } from './core/ctx-symbols.ts'
import { isProcedureDef } from './core/router-utils.ts'
import { validateSchema } from './core/schema.ts'

import type { AnySchema } from './core/schema.ts'
import type { ProcedureDef, GuardDef, WrapDef, ErrorDef, Route } from './types.ts'

/** Re-exported for backwards compatibility with consumers that read the slot directly. */
export { RAW_INPUT } from './core/ctx-symbols.ts'

/**
 * Compiled pipeline — always async. Returning a Promise uniformly keeps
 * callers (handler, caller, ws) from branching on sync vs async results.
 */
export type CompiledHandler = (
  ctx: Record<string, unknown>,
  rawInput: unknown,
  signal: AbortSignal,
) => Promise<unknown>

// ─── Error reporting helpers ──────────────────────────────────────────

/**
 * Build the `fail(code, data?)` function passed to resolvers.
 *
 * When the procedure declared typed errors, `fail` uses the declared status
 * and message. Otherwise it throws an undefined error that error middleware
 * can convert to a generic 500.
 */
function buildFail(errors: ErrorDef | null | undefined): (code: string, data?: unknown) => never {
  if (!errors) {
    return (code, data) => {
      throw new SilgiError(code, { data, defined: false })
    }
  }
  return (code, data) => {
    const def = errors[code]
    const status = typeof def === 'number' ? def : (def?.status ?? 500)
    const message =
      typeof def === 'object' && def !== null && 'message' in def ? (def as { message?: string }).message : undefined
    throw new SilgiError(code, { status, message, data, defined: true })
  }
}

// ─── Prototype-pollution protection ───────────────────────────────────

/**
 * Keys forbidden anywhere in a guard's return value. Blocking these at
 * every level protects `ctx` (which is a plain object) from attacker-supplied
 * nested payloads that could silently reach `Object.prototype`.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Return a copy of `value` with any `__proto__` / `constructor` / `prototype`
 * keys removed from plain-object nodes. Arrays and class instances are left
 * alone; only plain objects are rebuilt, and only when they actually contain
 * a forbidden key.
 *
 * This is pure (no in-place mutation) so guards cannot surprise callers that
 * still hold a reference to the original input.
 */
function sanitize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.map(sanitize)
  }

  // Leave class instances (anything not produced by an object literal) alone.
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value

  const source = value as Record<string, unknown>
  const cleaned: Record<string, unknown> = Object.create(null)
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue
    cleaned[key] = sanitize(source[key])
  }
  return cleaned
}

// ─── Guards ───────────────────────────────────────────────────────────

/**
 * Apply a guard's return value to the live context. Guards typically return
 * a partial context patch (e.g. `{ user }`) that we merge in; returning
 * nothing is fine and is how guards that only validate are expressed.
 */
function mergeGuardResult(ctx: Record<string, unknown>, result: unknown): void {
  if (result === null || typeof result !== 'object') return
  const patch = result as Record<string, unknown>
  for (const key of Object.keys(patch)) {
    if (UNSAFE_KEYS.has(key)) continue
    ctx[key] = sanitize(patch[key])
  }
}

/** Run every guard in order, awaiting any that return a Promise. */
async function runGuards(ctx: Record<string, unknown>, guards: readonly GuardDef[]): Promise<void> {
  for (const guard of guards) {
    mergeGuardResult(ctx, await guard.fn(ctx))
  }
}

// ─── Wrap onion ───────────────────────────────────────────────────────

/**
 * Compose the wrap chain around `core`. Wraps run outermost-first, so we
 * fold from the end of the list: the last wrap wraps `core`, the one before
 * it wraps that, and so on.
 *
 * When there are no wraps we just return `core` unchanged — no extra layer.
 */
function composeWraps(
  wraps: readonly WrapDef[],
  core: (ctx: Record<string, unknown>) => Promise<unknown>,
): (ctx: Record<string, unknown>) => Promise<unknown> {
  let chain = core
  for (let i = wraps.length - 1; i >= 0; i--) {
    const wrap = wraps[i]!
    const next = chain
    chain = (ctx) => Promise.resolve(wrap.fn(ctx, () => next(ctx)))
  }
  return chain
}

// ─── Procedure compilation ────────────────────────────────────────────

/**
 * Compile a single procedure into its request handler.
 *
 * `rootWraps` is the instance-level wrap stack (from `silgi({ wraps })`).
 * Root wraps are the outermost layer, so they are prepended before any
 * procedure-level wraps added via `$use(wrap)`.
 */
export function compileProcedure(procedure: ProcedureDef, rootWraps?: readonly WrapDef[] | null): CompiledHandler {
  // Split `$use` entries into guards (pre-steps) and wraps (onion middleware).
  const middlewares = procedure.use ?? []
  const guards: GuardDef[] = []
  const procedureWraps: WrapDef[] = []
  for (const mw of middlewares) {
    if (mw.kind === 'guard') guards.push(mw)
    else procedureWraps.push(mw)
  }

  // Root wraps sit outside procedure wraps in the onion.
  const wraps: WrapDef[] = rootWraps && rootWraps.length > 0 ? [...rootWraps, ...procedureWraps] : procedureWraps

  // Guards can declare their own typed errors. Merge them into the procedure's
  // error map so `fail('CODE')` works from inside a guard-introduced code.
  let mergedErrors = procedure.errors
  for (const guard of guards) {
    if (guard.errors) {
      mergedErrors = mergedErrors ? { ...mergedErrors, ...guard.errors } : guard.errors
    }
  }

  const fail = buildFail(mergedErrors)
  const inputSchema = procedure.input
  const outputSchema = procedure.output
  const resolve = procedure.resolve

  /**
   * Core pipeline step called from inside the wrap onion. Reads the
   * (already-validated) input back off `ctx[RAW_INPUT]` so that a wrap
   * like `mapInput` can still rewrite it between wraps and the resolver,
   * then calls the resolver.
   *
   * Input validation runs *outside* `core` — before the wrap onion —
   * because schemas (e.g. `z.number()`) rejecting a raw string is the
   * documented behavior. Wraps that need to transform the raw request
   * (like `coerceGuard`) must use an input schema that accepts the raw
   * shape, or pair with `z.coerce.*`.
   */
  const core = async (ctx: Record<string, unknown>): Promise<unknown> => {
    const input = (ctx as Record<PropertyKey, unknown>)[RAW_INPUT]
    const output = await resolve({
      input,
      ctx,
      fail,
      signal: (ctx as Record<PropertyKey, unknown>)[SIGNAL_KEY] as AbortSignal,
      params: (ctx.params ?? EMPTY_PARAMS) as Record<string, string>,
    })
    return output
  }

  const wrapped = composeWraps(wraps, core)

  return async (ctx, rawInput, signal) => {
    // Guards run first — they can throw to short-circuit the whole pipeline
    // and may also patch the context for downstream steps.
    await runGuards(ctx, guards)

    // Input validation happens here, *before* the wrap onion. This order
    // is deliberate and load-bearing; see the `core` doc-comment above.
    const input = inputSchema ? await validateSchema(inputSchema, rawInput ?? {}) : rawInput

    // Park request-scoped values on the context so `core` and any wrap
    // (e.g. `mapInput`) can read/rewrite them without extra parameters.
    ;(ctx as Record<PropertyKey, unknown>)[RAW_INPUT] = input
    ;(ctx as Record<PropertyKey, unknown>)[SIGNAL_KEY] = signal

    const output = await wrapped(ctx)
    return outputSchema ? await validateSchema(outputSchema, output) : output
  }
}

/**
 * Internal slot where we park the `AbortSignal` for the duration of a
 * request, alongside the raw input. Kept as a symbol so it cannot collide
 * with a user-defined context field.
 */
const SIGNAL_KEY = Symbol.for('silgi.signal')

/** Shared empty params object. Only read, never mutated, never exposed. */
const EMPTY_PARAMS: Record<string, string> = Object.freeze(Object.create(null))

// ─── Router compilation ───────────────────────────────────────────────

export interface CompiledRoute {
  handler: CompiledHandler
  /** Pre-computed `Cache-Control` header value, or `undefined` when caching is off. */
  cacheControl?: string
  /** When true, the adapter skips body parsing and hands the raw request to the resolver. */
  passthrough?: boolean
  /** Uppercase HTTP method this route was registered for. */
  method: string
}

export interface MatchedRoute<T = unknown> {
  data: T
  params?: Record<string, string>
}

/** Looks up a compiled route by (method, path). Returns `undefined` on miss. */
export type CompiledRouterFn = (method: string, path: string) => MatchedRoute<CompiledRoute> | undefined

/**
 * Walk the router definition tree and compile every procedure into a
 * rou3 radix router. Non-procedure nodes are namespaces and their keys
 * become path segments.
 */
export function compileRouter(def: Record<string, unknown>): CompiledRouterFn {
  const router = createRou3<CompiledRoute>()

  // `silgi({ wraps }).router(def)` stamps root wraps onto the def via a
  // non-enumerable symbol. Reading them here means every adapter that
  // goes through `compileRouter` (handler, caller, WS, etc.) gets root
  // wraps wired in automatically — no per-adapter plumbing.
  const rootWraps = (def as { [ROOT_WRAPS]?: readonly WrapDef[] })[ROOT_WRAPS]

  const register = (proc: ProcedureDef, autoPath: string[]): void => {
    const route = proc.route as Route | null

    // Explicit route path wins; otherwise we derive one from the tree position.
    const routePath = route?.path || '/' + autoPath.join('/')
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

    // The empty-method slot exists for `createCaller`, which dispatches
    // procedures directly without an HTTP method.
    addRou3Route(router, '', routePath, compiled)
  }

  const walk = (node: unknown, path: string[]): void => {
    if (isProcedureDef(node)) {
      register(node as ProcedureDef, path)
      return
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, child] of Object.entries(node)) {
        walk(child, [...path, key])
      }
    }
  }

  walk(def, [])

  return (method, path) => findRou3Route(router, method, path) as MatchedRoute<CompiledRoute> | undefined
}

// ─── Request context ──────────────────────────────────────────────────

/**
 * Disposable wrapper around the pipeline context. The `using` support lets
 * handlers write:
 *
 *     using ctx = createContext()
 *
 * which releases the context automatically at scope exit — unless ownership
 * has been transferred (e.g. to a streaming Response that keeps reading
 * from `ctx` after the handler returns). In that case the handler calls
 * `detachContext(ctx)` and the new owner is responsible for cleanup.
 */
export type PooledContext = Record<string, unknown> & Disposable

/**
 * Create a fresh context object. We use a null-prototype object so user
 * fields cannot accidentally shadow `Object.prototype` members, and so
 * that property lookups never walk the prototype chain.
 *
 * The object was once drawn from a pool; the pool has been removed because
 * its win was marginal and the indirection made the code harder to read.
 * The `createContext` / `releaseContext` / `detachContext` API is kept
 * intact so existing call sites continue to work.
 */
export function createContext(): PooledContext {
  const ctx = Object.create(null) as PooledContext
  ctx[Symbol.dispose] = disposeContext
  return ctx
}

/**
 * Mark the context as owned elsewhere so the enclosing `using` block will
 * not release it. Call this when you hand `ctx` to something that outlives
 * the handler scope (an SSE stream, a WebSocket subscription, etc.).
 */
export function detachContext(ctx: Record<string, unknown>): void {
  ;(ctx as Record<PropertyKey, unknown>)[Symbol.dispose] = noopDispose
}

/**
 * Release a context object. Called automatically at `using` scope exit
 * and explicitly by stream handlers when their stream ends. The body is
 * intentionally empty: we no longer pool, so there is nothing to reset.
 * The function is kept so callers have a single symmetrical API — every
 * `createContext` has a matching `releaseContext`.
 */
export function releaseContext(_ctx: Record<string, unknown>): void {
  // No pool to return to; the GC handles reclamation.
}

function disposeContext(this: Record<string, unknown>): void {
  releaseContext(this)
}

function noopDispose(): void {}
