/**
 * Silgi v2 API — Type definitions.
 *
 * Every procedure has the EXACT same shape (7 properties, same order)
 * → V8 assigns ONE hidden class → monomorphic inline caches.
 */

import type { AnySchema, InferSchemaInput } from './core/schema.ts'

/** HTTP route metadata + OpenAPI operation metadata */
export interface Route {
  method?: string
  path?: string
  /** Short summary of the operation (OpenAPI `summary`) */
  summary?: string
  /** Detailed description of the operation (OpenAPI `description`, supports markdown) */
  description?: string
  /** Tags for grouping operations in API docs */
  tags?: string[]
  /** Mark operation as deprecated in API docs */
  deprecated?: boolean
  /** Custom operationId (default: router path joined with `_`) */
  operationId?: string
  /** HTTP status code for successful responses (default: 200) */
  successStatus?: number
  /** Description for the success response in API docs */
  successDescription?: string
  /**
   * Per-procedure security override.
   * - `false` — public endpoint (no auth), overrides global security
   * - `string[]` — named security scheme(s) required
   */
  security?: false | string[]
  /**
   * Override or extend the auto-generated OpenAPI operation object.
   * - Object: merged over the generated operation
   * - Function: receives the generated operation, returns the final one
   *
   * Use this for any OpenAPI metadata not covered by other Route fields
   * (e.g. `externalDocs`, `x-` extensions, custom `parameters`).
   */
  spec?: Record<string, unknown> | ((operation: Record<string, unknown>) => Record<string, unknown>)
  /**
   * Cache-Control header for query responses.
   *
   * - `number` — shorthand for `max-age=N` (seconds)
   * - `string` — full Cache-Control value (e.g. `'public, max-age=60, stale-while-revalidate=30'`)
   * - Only applies to query procedures (mutations and subscriptions are never cached)
   */
  cache?: number | string
  /** Enable WebSocket RPC for this procedure */
  ws?: boolean
}

/** Procedure metadata */
export type Meta = Record<string, unknown>

// ── Procedure Types ────────────────────────────────

export type ProcedureType = 'query' | 'mutation' | 'subscription'

/** Internal procedure representation — fixed shape for V8 optimization */
export interface ProcedureDef<
  TType extends ProcedureType = ProcedureType,
  _TInput = unknown,
  _TOutput = unknown,
  TErrors extends ErrorDef = ErrorDef,
> {
  readonly type: TType
  readonly input: AnySchema | null
  readonly output: AnySchema | null
  readonly errors: TErrors | null
  readonly use: readonly MiddlewareDef[] | null
  readonly resolve: Function
  readonly route: Route | null
  readonly meta: Meta | null
}

// ── Error Types ────────────────────────────────────

/** Error definition: number shorthand or full config */
export type ErrorDefItem = number | { status: number; message?: string; data?: AnySchema }
export type ErrorDef = Record<string, ErrorDefItem>

/** Extract data schema from error def item */
type ErrorData<T extends ErrorDefItem> = T extends { data: infer S extends AnySchema } ? InferSchemaInput<S> : undefined

/** Typed fail() function — inferred from errors definition */
export type FailFn<TErrors extends ErrorDef> = <K extends keyof TErrors & string>(
  code: K,
  ...args: ErrorData<TErrors[K]> extends undefined ? [data?: unknown] : [data: ErrorData<TErrors[K]>]
) => never

// ── Middleware Types ───────────────────────────────

export type GuardFn<TCtxIn, TReturn> = (ctx: TCtxIn) => TReturn | Promise<TReturn> | void | Promise<void>

export type WrapFn<TCtx> = (ctx: TCtx, next: () => Promise<unknown>) => Promise<unknown>

export interface GuardDef<TCtxIn = unknown, TReturn = unknown, TErrors extends ErrorDef = {}> {
  readonly kind: 'guard'
  readonly fn: GuardFn<TCtxIn, TReturn>
  readonly errors?: TErrors
}

export interface WrapDef<TCtx = unknown> {
  readonly kind: 'wrap'
  readonly fn: WrapFn<TCtx>
}

export type MiddlewareDef = GuardDef<any, any> | WrapDef<any>

// ── Context Inference from use[] ──────────────────

/** Extract the context additions from a single guard */
export type InferGuardOutput<T> =
  T extends GuardDef<any, infer O> ? (O extends void | undefined ? {} : O extends Record<string, unknown> ? O : {}) : {}

/** Walk a middleware tuple, accumulate guard outputs into context */
export type InferContextFromUse<T extends readonly MiddlewareDef[], TBase> = T extends readonly [
  infer Head,
  ...infer Tail extends readonly MiddlewareDef[],
]
  ? InferContextFromUse<Tail, TBase & InferGuardOutput<Head>>
  : TBase

/** Extract errors declared by a single guard */
export type InferGuardErrors<T> = T extends GuardDef<any, any, infer E> ? (E extends ErrorDef ? E : {}) : {}

/** Walk a middleware tuple, accumulate guard errors */
export type InferErrorsFromUse<T extends readonly MiddlewareDef[]> = T extends readonly [
  infer Head,
  ...infer Tail extends readonly MiddlewareDef[],
]
  ? InferGuardErrors<Head> & InferErrorsFromUse<Tail>
  : {}

// ── Resolve Context ───────────────────────────────

export interface ResolveContext<TCtx, TInput, TErrors extends ErrorDef> {
  ctx: TCtx
  input: TInput
  fail: FailFn<TErrors>
  signal: AbortSignal
  /** URL params extracted from the route pattern (e.g. `/users/:id` → `{ id: '123' }`) */
  params: Record<string, string>
}

// ── Config Forms ──────────────────────────────────

// ── Router Types ──────────────────────────────────

export type RouterDef = {
  [key: string]: ProcedureDef<any, any, any, any> | RouterDef
}

/** Infer client type from router */
export type InferClient<T> =
  T extends ProcedureDef<infer TType, infer TInput, infer TOutput>
    ? TType extends 'subscription'
      ? undefined extends TInput
        ? () => AsyncIterableIterator<TOutput>
        : (input: TInput) => AsyncIterableIterator<TOutput>
      : undefined extends TInput
        ? () => Promise<TOutput>
        : (input: TInput) => Promise<TOutput>
    : T extends Record<string, unknown>
      ? { [K in keyof T]: InferClient<T[K]> }
      : never
