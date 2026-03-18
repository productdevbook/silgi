/**
 * Katman v2 API — Type definitions.
 *
 * Every procedure has the EXACT same shape (7 properties, same order)
 * → V8 assigns ONE hidden class → monomorphic inline caches.
 */

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from "./core/schema.ts";
import type { Route } from "./contract/route.ts";
import type { Meta } from "./contract/meta.ts";

// ── Procedure Types ────────────────────────────────

export type ProcedureType = "query" | "mutation" | "subscription";

/** Internal procedure representation — fixed shape for V8 optimization */
export interface ProcedureDef<
  TType extends ProcedureType = ProcedureType,
  TInput = unknown,
  TOutput = unknown,
  TErrors extends ErrorDef = ErrorDef,
> {
  readonly type: TType;
  readonly input: AnySchema | null;
  readonly output: AnySchema | null;
  readonly errors: TErrors | null;
  readonly use: readonly MiddlewareDef[] | null;
  readonly resolve: Function;
  readonly route: Route | null;
}

// ── Error Types ────────────────────────────────────

/** Error definition: number shorthand or full config */
export type ErrorDefItem = number | { status: number; message?: string; data?: AnySchema };
export type ErrorDef = Record<string, ErrorDefItem>;

/** Extract status from error def item */
type ErrorStatus<T extends ErrorDefItem> = T extends number ? T : T extends { status: infer S } ? S : 500;

/** Extract data schema from error def item */
type ErrorData<T extends ErrorDefItem> =
  T extends { data: infer S extends AnySchema } ? InferSchemaInput<S> : undefined;

/** Typed fail() function — inferred from errors definition */
export type FailFn<TErrors extends ErrorDef> = <K extends keyof TErrors & string>(
  code: K,
  ...args: ErrorData<TErrors[K]> extends undefined ? [data?: unknown] : [data: ErrorData<TErrors[K]>]
) => never;

// ── Middleware Types ───────────────────────────────

export type GuardFn<TCtxIn, TReturn> =
  (ctx: TCtxIn) => TReturn | Promise<TReturn> | void | Promise<void>;

export type WrapFn<TCtx> =
  (ctx: TCtx, next: () => Promise<unknown>) => Promise<unknown>;

export interface GuardDef<TCtxIn = unknown, TReturn = unknown> {
  readonly kind: "guard";
  readonly fn: GuardFn<TCtxIn, TReturn>;
}

export interface WrapDef<TCtx = unknown> {
  readonly kind: "wrap";
  readonly fn: WrapFn<TCtx>;
}

export type MiddlewareDef = GuardDef<any, any> | WrapDef<any>;

// ── Context Inference from use[] ──────────────────

/** Extract the context additions from a single guard */
export type InferGuardOutput<T> =
  T extends GuardDef<any, infer O>
    ? O extends void | undefined ? {} : O extends Record<string, unknown> ? O : {}
    : {};

/** Walk a middleware tuple, accumulate guard outputs into context */
export type InferContextFromUse<
  T extends readonly MiddlewareDef[],
  TBase,
> = T extends readonly [infer Head, ...infer Tail extends readonly MiddlewareDef[]]
  ? InferContextFromUse<Tail, TBase & InferGuardOutput<Head>>
  : TBase;

// ── Resolve Context ───────────────────────────────

export interface ResolveContext<TCtx, TInput, TErrors extends ErrorDef> {
  ctx: TCtx;
  input: TInput;
  fail: FailFn<TErrors>;
  signal: AbortSignal;
}

// ── Config Forms ──────────────────────────────────

export interface ProcedureConfig<
  TCtx,
  TInputSchema extends AnySchema | undefined,
  TOutput,
  TErrors extends ErrorDef,
  TUse extends readonly MiddlewareDef[],
> {
  use?: TUse;
  input?: TInputSchema;
  output?: AnySchema;
  errors?: TErrors;
  resolve: (
    opts: ResolveContext<
      InferContextFromUse<TUse, TCtx>,
      TInputSchema extends AnySchema ? InferSchemaOutput<TInputSchema> : undefined,
      NoInfer<TErrors>
    >,
  ) => Promise<TOutput> | TOutput;
  route?: Route;
  meta?: Meta;
}

// ── Router Types ──────────────────────────────────

export type RouterDef = {
  [key: string]: ProcedureDef<any, any, any, any> | RouterDef;
};

/** Infer client type from router */
export type InferClient<T> =
  T extends ProcedureDef<infer TType, infer TInput, infer TOutput>
    ? TType extends "subscription"
      ? undefined extends TInput
        ? () => AsyncIterableIterator<TOutput>
        : (input: TInput) => AsyncIterableIterator<TOutput>
      : undefined extends TInput
        ? () => Promise<TOutput>
        : (input: TInput) => Promise<TOutput>
    : T extends Record<string, unknown>
      ? { [K in keyof T]: InferClient<T[K]> }
      : never;
