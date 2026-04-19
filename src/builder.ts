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

import { createTaskFromProcedure } from './core/task.ts'

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './core/schema.ts'
import type { TaskConfig, TaskDef, TaskEvent } from './core/task.ts'
import type {
  ProcedureDef,
  ProcedureType,
  ErrorDef,
  GuardDef,
  WrapDef,
  MiddlewareDef,
  ResolveContext,
  Route,
  Meta,
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
  /** Add a guard — enriches context with guard return type */
  $use<TReturn extends Record<string, unknown> | void, TGErrors extends ErrorDef = {}>(
    guard: GuardDef<any, TReturn, TGErrors>,
  ): ProcedureBuilder<
    TType,
    TBaseCtx,
    TReturn extends Record<string, unknown> ? TCtx & TReturn : TCtx,
    TInput,
    TGErrors & TErrors
  >

  /** Add a wrap middleware — does not change context type */
  $use(wrap: WrapDef<any>): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /**
   * Add a middleware of unknown variant (`GuardDef | WrapDef`).
   *
   * @remarks
   * Used by factory-pattern builders that accept middleware through a
   * dependency boundary where the concrete variant isn't known at the
   * call site. Context is not enriched — if you need guard-added fields
   * in `.$resolve()`, pass the guard with its concrete type or use
   * `defineRouteKit` to bind the ctx shape up front.
   */
  $use(mw: MiddlewareDef): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

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

  /** Create a background task — guards, input, errors all apply */
  $task<TOutput>(config: {
    name: string
    cron?: string
    description?: string
    resolve: (event: TaskEvent<TInput, TCtx>) => Promise<TOutput> | TOutput
  }): TaskDef<TInput, TOutput>
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
  /** Add a guard — enriches context with guard return type */
  $use<TReturn extends Record<string, unknown> | void, TGErrors extends ErrorDef = {}>(
    guard: GuardDef<any, TReturn, TGErrors>,
  ): ProcedureBuilderWithOutput<
    TType,
    TBaseCtx,
    TReturn extends Record<string, unknown> ? TCtx & TReturn : TCtx,
    TInput,
    TOutputResolved,
    TGErrors & TErrors
  >

  /** Add a wrap middleware — does not change context type */
  $use(wrap: WrapDef<any>): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /**
   * Add a middleware of unknown variant (`GuardDef | WrapDef`).
   *
   * @remarks
   * Used by factory-pattern builders that accept middleware through a
   * dependency boundary where the concrete variant isn't known at the
   * call site.
   */
  $use(mw: MiddlewareDef): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

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

  /** Create a background task — guards, input, output, errors all apply */
  $task(config: {
    name: string
    cron?: string
    description?: string
    resolve: (event: TaskEvent<TInput, TCtx>) => Promise<TOutputResolved> | TOutputResolved
  }): TaskDef<TInput, TOutputResolved>
}

// ── Builder Implementation ──────────────────────────

class ProcBuilder {
  type: ProcedureType
  input: AnySchema | null = null
  output: AnySchema | null = null
  errors: ErrorDef | null = null
  use: MiddlewareDef[] | null = null
  resolve: Function | null = null
  route: Route | null = null
  meta: Meta | null = null

  // Set by createProcedureBuilder when created via silgi instance
  _contextFactory: (() => unknown | Promise<unknown>) | null = null

  constructor(type: ProcedureType) {
    this.type = type
  }

  $use(...middleware: MiddlewareDef[]) {
    if (this.use) (this.use as MiddlewareDef[]).push(...middleware)
    else this.use = [...middleware]
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

  $task(config: TaskConfig & { resolve: Function }): TaskDef {
    return createTaskFromProcedure(config, config.resolve, this.input, this.use, this._contextFactory)
  }
}

export function createProcedureBuilder<TType extends ProcedureType, TBaseCtx extends Record<string, unknown>>(
  type: TType,
  contextFactory?: (() => unknown | Promise<unknown>) | null,
): ProcedureBuilder<TType, TBaseCtx> {
  const b = new ProcBuilder(type)
  if (contextFactory) b._contextFactory = contextFactory
  return b as unknown as ProcedureBuilder<TType, TBaseCtx>
}
