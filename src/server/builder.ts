/**
 * Server Builder — the `ks` entry point.
 *
 * Fluent API for defining server procedures and routers.
 * Each method returns a new builder (immutable, copy-on-write).
 *
 * The builder accumulates middlewares, schemas, error maps, and route metadata.
 * When `.handler()` is called, it creates a Procedure with the compiled pipeline.
 */

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from "../core/schema.ts";
import type { Context, Promisable } from "../core/types.ts";
import type { AnyMiddleware, Handler, Middleware, MiddlewareResult } from "../core/pipeline.ts";
import type { ErrorMap, ErrorMapItem } from "../contract/error.ts";
import type { Meta } from "../contract/meta.ts";
import type { Route } from "../contract/route.ts";
import type { AnyContractRouter } from "../contract/router.ts";
import type { MergedCurrentContext, MergedInitialContext } from "./context.ts";
import { Procedure, type ProcedureDef } from "./procedure.ts";
import { mergeErrorMap } from "../contract/error.ts";
import { mergeRoute, enhanceRoute } from "../contract/route.ts";
import { mergeMeta } from "../contract/meta.ts";
import { mergeMiddlewares } from "../core/pipeline.ts";

/**
 * Configuration that affects pipeline compilation.
 */
export interface BuilderConfig {
  initialInputValidationIndex: number;
  initialOutputValidationIndex: number;
  dedupeLeadingMiddlewares: boolean;
}

const DEFAULT_CONFIG: BuilderConfig = {
  initialInputValidationIndex: 0,
  initialOutputValidationIndex: 0,
  dedupeLeadingMiddlewares: true,
};

interface BuilderDef {
  config: BuilderConfig;
  middlewares: readonly AnyMiddleware[];
  inputSchema?: AnySchema;
  outputSchema?: AnySchema;
  errorMap: ErrorMap;
  route: Route;
  meta: Meta;
  inputValidationIndex: number;
  outputValidationIndex: number;
  prefix?: string;
  tags?: string[];
}

export class Builder<
  TInitialContext extends Context = Record<never, never>,
  TCurrentContext extends Context = Record<never, never>,
  TInputSchema extends AnySchema | undefined = undefined,
  TOutputSchema extends AnySchema | undefined = undefined,
  TErrorMap extends ErrorMap = Record<never, never>,
  TMeta extends Meta = Record<never, never>,
> {
  readonly "~katman": BuilderDef;

  constructor(def: BuilderDef) {
    this["~katman"] = def;
  }

  // === Context Declaration ===

  $context<T extends Context>(): Builder<T, T, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this["~katman"],
      middlewares: [],
      inputValidationIndex: this["~katman"].config.initialInputValidationIndex,
      outputValidationIndex: this["~katman"].config.initialOutputValidationIndex,
    });
  }

  $config(config: Partial<BuilderConfig>): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    const merged = { ...this["~katman"].config, ...config };
    return new Builder({ ...this["~katman"], config: merged });
  }

  // === Middleware ===

  use<UOutContext extends Context, UInContext extends Context = TCurrentContext>(
    middleware: Middleware<UInContext | TCurrentContext, UOutContext, unknown, unknown, TMeta>,
  ): Builder<
    MergedInitialContext<TInitialContext, UInContext, TCurrentContext>,
    MergedCurrentContext<TCurrentContext, UOutContext>,
    TInputSchema,
    TOutputSchema,
    TErrorMap,
    TMeta
  > {
    return new Builder({
      ...this["~katman"],
      middlewares: [...this["~katman"].middlewares, middleware as AnyMiddleware],
    });
  }

  // === Schema ===

  input<TSchema extends AnySchema>(
    schema: TSchema,
  ): Builder<TInitialContext, TCurrentContext, TSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this["~katman"],
      inputSchema: schema,
      inputValidationIndex: this["~katman"].middlewares.length,
    });
  }

  output<TSchema extends AnySchema>(
    schema: TSchema,
  ): Builder<TInitialContext, TCurrentContext, TInputSchema, TSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this["~katman"],
      outputSchema: schema,
      outputValidationIndex: this["~katman"].middlewares.length,
    });
  }

  // === Metadata ===

  errors<T extends Record<string, ErrorMapItem<AnySchema> | undefined>>(
    errors: T,
  ): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap & T, TMeta> {
    return new Builder({
      ...this["~katman"],
      errorMap: mergeErrorMap(this["~katman"].errorMap, errors) as TErrorMap & T,
    });
  }

  meta<T extends Meta>(meta: T): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta & T> {
    return new Builder({
      ...this["~katman"],
      meta: mergeMeta(this["~katman"].meta, meta) as TMeta & T,
    });
  }

  route(route: Route): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this["~katman"],
      route: mergeRoute(this["~katman"].route, route),
    });
  }

  // === Handler (terminates the chain) ===

  handler<TOutput>(
    fn: (options: {
      context: TCurrentContext;
      input: TInputSchema extends AnySchema ? InferSchemaOutput<TInputSchema> : unknown;
      path: readonly string[];
      signal: AbortSignal;
      meta: TMeta;
      errors: import("./error.ts").ErrorConstructorMap<TErrorMap>;
    }) => Promisable<
      TOutputSchema extends AnySchema ? InferSchemaInput<TOutputSchema> : TOutput
    >,
  ): Procedure<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Procedure({
      inputSchema: this["~katman"].inputSchema as TInputSchema,
      outputSchema: this["~katman"].outputSchema as TOutputSchema,
      errorMap: this["~katman"].errorMap as TErrorMap,
      route: this["~katman"].route,
      meta: this["~katman"].meta as TMeta,
      middlewares: this["~katman"].middlewares,
      handler: fn as Handler,
      inputValidationIndex: this["~katman"].inputValidationIndex,
      outputValidationIndex: this["~katman"].outputValidationIndex,
    });
  }

  // === Router Methods ===

  prefix(prefix: string): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this["~katman"],
      prefix: (this["~katman"].prefix ?? "") + prefix,
    });
  }

  tag(...tags: string[]): Builder<TInitialContext, TCurrentContext, TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new Builder({
      ...this["~katman"],
      tags: [...(this["~katman"].tags ?? []), ...tags],
    });
  }

  /**
   * Apply accumulated middlewares, prefix, tags, errors to a router.
   */
  router<T extends Record<string, unknown>>(router: T): T {
    return enhanceRouter(router, {
      middlewares: this["~katman"].middlewares,
      errorMap: this["~katman"].errorMap,
      prefix: this["~katman"].prefix,
      tags: this["~katman"].tags,
      dedupeLeading: this["~katman"].config.dedupeLeadingMiddlewares,
      inputValidationIndex: this["~katman"].inputValidationIndex,
      outputValidationIndex: this["~katman"].outputValidationIndex,
    }) as T;
  }
}

/**
 * Enhance a router by prepending middlewares, merging error maps, etc.
 */
function enhanceRouter(
  router: unknown,
  options: {
    middlewares: readonly AnyMiddleware[];
    errorMap: ErrorMap;
    prefix?: string;
    tags?: string[];
    dedupeLeading: boolean;
    inputValidationIndex: number;
    outputValidationIndex: number;
  },
): unknown {
  if (router instanceof Procedure) {
    const def = router["~katman"];
    const newMiddlewares = mergeMiddlewares(
      options.middlewares,
      def.middlewares,
      options.dedupeLeading,
    );
    const added = newMiddlewares.length - def.middlewares.length;

    return new Procedure({
      ...def,
      middlewares: newMiddlewares,
      errorMap: mergeErrorMap(options.errorMap, def.errorMap),
      route: enhanceRoute(def.route, {
        prefix: options.prefix,
        tags: options.tags,
      }),
      inputValidationIndex: def.inputValidationIndex + added,
      outputValidationIndex: def.outputValidationIndex + added,
    });
  }

  if (typeof router === "object" && router !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(router as Record<string, unknown>)) {
      result[key] = enhanceRouter(child, options);
    }
    return result;
  }

  return router;
}

/** The singleton entry point */
export const ks = new Builder({
  config: DEFAULT_CONFIG,
  middlewares: [],
  errorMap: {} as Record<never, never>,
  route: {},
  meta: {} as Record<never, never>,
  inputValidationIndex: 0,
  outputValidationIndex: 0,
});
