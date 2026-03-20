/**
 * Procedure Builder — chainable $-prefixed API with IDE autocomplete.
 *
 * @example
 * ```ts
 * const p = k
 *   .$input(inputSchema)
 *   .$output(PostSchema)
 *   .$resolve(() => ({ id: 1, title: 'hi', body: 'x' }))
 *   // ← autocomplete suggests id, title, body
 * ```
 */

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './core/schema.ts'
import type {
  ProcedureDef,
  ProcedureType,
  ErrorDef,
  MiddlewareDef,
  GuardDef,
  WrapDef,
  ResolveContext,
  Route,
  Meta,
  InferContextFromUse,
  InferErrorsFromUse,
} from './types.ts'

// ── Builder Interfaces ──────────────────────────────

/** Initial builder — no input, no output, no errors yet */
export interface ProcedureBuilder<
  TType extends ProcedureType,
  TBaseCtx extends Record<string, unknown>,
  TCtx extends Record<string, unknown> = TBaseCtx,
  TInput = undefined,
  TErrors extends ErrorDef = {},
> {
  /** Add middleware (guards and wraps) */
  $use<TReturn extends Record<string, unknown> | void>(
    ...middleware: readonly MiddlewareDef[]
  ): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /** Set input schema */
  $input<TSchema extends AnySchema>(
    schema: TSchema,
  ): ProcedureBuilder<TType, TBaseCtx, TCtx, InferSchemaOutput<TSchema>, TErrors>

  /** Set output schema — enables return type autocomplete */
  $output<TSchema extends AnySchema>(
    schema: TSchema,
  ): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, InferSchemaInput<TSchema>, TErrors>

  /** Set typed errors */
  $errors<TNewErrors extends ErrorDef>(
    errors: TNewErrors,
  ): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TNewErrors & TErrors>

  /** Set route metadata */
  $route(route: Route): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /** Set custom metadata */
  $meta(meta: Meta): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /** Resolve — freely inferred return type (no output schema) */
  $resolve<TOutput>(
    fn: TType extends 'subscription'
      ? (opts: ResolveContext<TCtx, TInput, TErrors>) => AsyncIterableIterator<TOutput>
      : (opts: ResolveContext<TCtx, TInput, TErrors>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<TType, TInput, TOutput, TErrors>
}

/** Builder after .$output() — return type is constrained for autocomplete */
export interface ProcedureBuilderWithOutput<
  TType extends ProcedureType,
  TBaseCtx extends Record<string, unknown>,
  TCtx extends Record<string, unknown>,
  TInput,
  TOutputResolved,
  TErrors extends ErrorDef,
> {
  /** Add middleware */
  $use(
    ...middleware: readonly MiddlewareDef[]
  ): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /** Set typed errors */
  $errors<TNewErrors extends ErrorDef>(
    errors: TNewErrors,
  ): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TNewErrors & TErrors>

  /** Set route metadata */
  $route(route: Route): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /** Set custom metadata */
  $meta(meta: Meta): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /** Resolve — return type constrained to output schema (autocomplete works) */
  $resolve(
    fn: TType extends 'subscription'
      ? (opts: ResolveContext<TCtx, TInput, TErrors>) => AsyncIterableIterator<TOutputResolved>
      : (opts: ResolveContext<TCtx, TInput, TErrors>) => Promise<TOutputResolved> | TOutputResolved,
  ): ProcedureDef<TType, TInput, TOutputResolved, TErrors>
}

// ── Builder Implementation ──────────────────────────
// Self-rewrite pattern for V8 optimization:
// - ProcedureDef properties live directly on the instance
// - $resolve() sets `resolve` and returns `this` as ProcedureDef
// - Zero extra allocation: builder IS the final ProcedureDef
// - ~2ns creation (vs 13ns class + new object, vs 1.7ns config literal)

class ProcBuilder {
  // ProcedureDef shape — same property names, same order
  type: ProcedureType
  input: AnySchema | null = null
  output: AnySchema | null = null
  errors: ErrorDef | null = null
  use: MiddlewareDef[] | null = null
  resolve: Function | null = null
  route: Route | null = null
  meta: Meta | null = null

  constructor(type: ProcedureType) {
    this.type = type
  }

  $use(...middleware: MiddlewareDef[]) {
    if (this.use) (this.use as MiddlewareDef[]).push(...middleware)
    else this.use = middleware
    return this
  }

  $input(schema: AnySchema) {
    this.input = schema
    return this
  }

  $output(schema: AnySchema) {
    this.output = schema
    return this
  }

  $errors(errors: ErrorDef) {
    this.errors = this.errors ? { ...(this.errors as ErrorDef), ...errors } : errors
    return this
  }

  $route(route: Route) {
    this.route = route
    return this
  }

  $meta(meta: Meta) {
    this.meta = meta
    return this
  }

  $resolve(fn: Function): ProcedureDef {
    this.resolve = fn
    return this as unknown as ProcedureDef
  }
}

export function createProcedureBuilder<TType extends ProcedureType, TBaseCtx extends Record<string, unknown>>(
  type: TType,
): ProcedureBuilder<TType, TBaseCtx> {
  return new ProcBuilder(type) as unknown as ProcedureBuilder<TType, TBaseCtx>
}
