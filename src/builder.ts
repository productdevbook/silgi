/**
 * Procedure Builder — chainable API with IDE autocomplete for output schemas.
 *
 * Alternative to the config object form. Both produce the same ProcedureDef.
 *
 * @example
 * ```ts
 * // Config form (existing):
 * const p = k.query({ output: PostSchema, resolve: () => ({ ... }) })
 *
 * // Builder form (new — autocomplete on return type):
 * const p = k.query()
 *   .output(PostSchema)
 *   .resolve(() => ({ ... }))  // ← autocomplete for id, title, body
 * ```
 */

import type {
  AnySchema,
  InferSchemaInput,
  InferSchemaOutput,
} from './core/schema.ts'
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
  use<TReturn extends Record<string, unknown> | void>(
    ...middleware: readonly MiddlewareDef[]
  ): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /** Set input schema */
  input<TSchema extends AnySchema>(
    schema: TSchema,
  ): ProcedureBuilder<TType, TBaseCtx, TCtx, InferSchemaOutput<TSchema>, TErrors>

  /** Set output schema — enables return type autocomplete */
  output<TSchema extends AnySchema>(
    schema: TSchema,
  ): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, InferSchemaInput<TSchema>, TErrors>

  /** Set typed errors */
  errors<TNewErrors extends ErrorDef>(
    errors: TNewErrors,
  ): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TNewErrors & TErrors>

  /** Set route metadata */
  route(route: Route): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /** Set custom metadata */
  meta(meta: Meta): ProcedureBuilder<TType, TBaseCtx, TCtx, TInput, TErrors>

  /** Resolve — freely inferred return type (no output schema) */
  resolve<TOutput>(
    fn: TType extends 'subscription'
      ? (opts: ResolveContext<TCtx, TInput, TErrors>) => AsyncIterableIterator<TOutput>
      : (opts: ResolveContext<TCtx, TInput, TErrors>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<TType, TInput, TOutput, TErrors>
}

/** Builder after .output() — return type is constrained for autocomplete */
export interface ProcedureBuilderWithOutput<
  TType extends ProcedureType,
  TBaseCtx extends Record<string, unknown>,
  TCtx extends Record<string, unknown>,
  TInput,
  TOutputResolved,
  TErrors extends ErrorDef,
> {
  /** Add middleware */
  use(
    ...middleware: readonly MiddlewareDef[]
  ): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /** Set typed errors */
  errors<TNewErrors extends ErrorDef>(
    errors: TNewErrors,
  ): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TNewErrors & TErrors>

  /** Set route metadata */
  route(route: Route): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /** Set custom metadata */
  meta(meta: Meta): ProcedureBuilderWithOutput<TType, TBaseCtx, TCtx, TInput, TOutputResolved, TErrors>

  /** Resolve — return type constrained to output schema (autocomplete works) */
  resolve(
    fn: TType extends 'subscription'
      ? (opts: ResolveContext<TCtx, TInput, TErrors>) => AsyncIterableIterator<TOutputResolved>
      : (opts: ResolveContext<TCtx, TInput, TErrors>) => Promise<TOutputResolved> | TOutputResolved,
  ): ProcedureDef<TType, TInput, TOutputResolved, TErrors>
}

// ── Builder Implementation ──────────────────────────

interface BuilderState {
  type: ProcedureType
  use: MiddlewareDef[]
  input: AnySchema | null
  output: AnySchema | null
  errors: ErrorDef | null
  route: Route | null
  meta: Meta | null
}

export function createProcedureBuilder<
  TType extends ProcedureType,
  TBaseCtx extends Record<string, unknown>,
>(type: TType): ProcedureBuilder<TType, TBaseCtx> {
  const state: BuilderState = {
    type,
    use: [],
    input: null,
    output: null,
    errors: null,
    route: null,
    meta: null,
  }

  const builder: any = {
    use(...middleware: MiddlewareDef[]) {
      state.use.push(...middleware)
      return builder
    },
    input(schema: AnySchema) {
      state.input = schema
      return builder
    },
    output(schema: AnySchema) {
      state.output = schema
      return builder
    },
    errors(errors: ErrorDef) {
      state.errors = state.errors ? { ...state.errors, ...errors } : errors
      return builder
    },
    route(route: Route) {
      state.route = route
      return builder
    },
    meta(meta: Meta) {
      state.meta = meta
      return builder
    },
    resolve(fn: Function): ProcedureDef {
      return {
        type: state.type,
        input: state.input,
        output: state.output,
        errors: state.errors,
        use: state.use.length > 0 ? state.use : null,
        resolve: fn,
        route: state.route,
        meta: state.meta,
      }
    },
  }

  return builder
}
