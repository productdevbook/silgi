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

export type RootWrapsGetter = (() => readonly WrapDef[] | null) | null

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

// ─── Builder implementation ───────────────────────────────────────────

/**
 * A `ProcBuilder` plays two roles in its lifetime:
 *
 *   1. While the user is chaining methods it is a *builder* — each `$x()`
 *      mutates a slot and returns `this`.
 *   2. Once `$resolve()` is called, the *same instance* is returned typed
 *      as `ProcedureDef`. This works because `isProcedureDef` (see
 *      `core/router-utils.ts`) only checks for `type` and a callable
 *      `resolve`, both of which we now have.
 *
 * Using one object for both roles avoids copying the slots into a fresh
 * frozen record at the end — callers hold the object directly, so the
 * shape they see is the same object we wrote into.
 *
 * All slots default to `null` rather than an empty array / object so
 * that downstream code can branch on presence without caring about
 * length, and so that we do not allocate sentinels the user never ends
 * up needing.
 */
class ProcBuilder {
  type: ProcedureType
  input: AnySchema | null = null
  output: AnySchema | null = null
  errors: ErrorDef | null = null
  use: MiddlewareDef[] | null = null
  resolve: Function | null = null
  route: Route | null = null
  meta: Meta | null = null

  /**
   * Underscore-prefixed slots are framework-internal. They are set by
   * `createProcedureBuilder` when the builder is constructed through a
   * `silgi({...})` instance and are threaded through to `$task()` so
   * that background tasks share the instance's context factory and
   * root wraps.
   */
  _contextFactory: (() => unknown | Promise<unknown>) | null = null
  _rootWrapsGetter: RootWrapsGetter = null

  constructor(type: ProcedureType) {
    this.type = type
  }

  $use(...middleware: MiddlewareDef[]): this {
    this.use ??= []
    this.use.push(...middleware)
    return this
  }

  $input(schema: AnySchema): this {
    this.input = schema
    return this
  }

  $output(schema: AnySchema): this {
    this.output = schema
    return this
  }

  $errors(errors: ErrorDef): this {
    this.errors = this.errors ? { ...this.errors, ...errors } : errors
    return this
  }

  $route(route: Route): this {
    this.route = route
    return this
  }

  $meta(meta: Meta): this {
    this.meta = meta
    return this
  }

  $resolve(fn: Function): ProcedureDef {
    this.resolve = fn
    // The double cast is the role switch described in the class comment:
    // the same instance now satisfies `ProcedureDef`.
    return this as unknown as ProcedureDef
  }

  $task(config: TaskConfig & { resolve: Function }): TaskDef {
    return createTaskFromProcedure(
      config,
      config.resolve,
      this.input,
      this.use,
      this._contextFactory,
      this._rootWrapsGetter,
    )
  }
}

export function createProcedureBuilder<TType extends ProcedureType, TBaseCtx extends Record<string, unknown>>(
  type: TType,
  contextFactory?: (() => unknown | Promise<unknown>) | null,
  rootWrapsGetter?: RootWrapsGetter,
): ProcedureBuilder<TType, TBaseCtx> {
  const builder = new ProcBuilder(type)
  if (contextFactory) builder._contextFactory = contextFactory
  if (rootWrapsGetter) builder._rootWrapsGetter = rootWrapsGetter
  return builder as unknown as ProcedureBuilder<TType, TBaseCtx>
}
