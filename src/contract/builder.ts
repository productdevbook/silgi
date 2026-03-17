/**
 * Contract Builder — the `kc` entry point.
 *
 * Fluent API for defining API contracts.
 * Immutable: every method returns a new builder.
 */

import type { AnySchema } from "../core/schema.ts";
import type { ErrorMap, ErrorMapItem } from "./error.ts";
import type { Meta } from "./meta.ts";
import type { Route } from "./route.ts";
import { ContractProcedure, type ContractProcedureDef } from "./procedure.ts";
import { mergeErrorMap } from "./error.ts";
import { mergeRoute, enhanceRoute, mergePrefix, mergeTags } from "./route.ts";
import { mergeMeta } from "./meta.ts";
import { isContractProcedure } from "./procedure.ts";
import type { AnyContractRouter } from "./router.ts";

interface ContractBuilderDef<
  TInputSchema extends AnySchema | undefined,
  TOutputSchema extends AnySchema | undefined,
  TErrorMap extends ErrorMap,
  TMeta extends Meta,
> extends ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  prefix?: string;
  tags?: string[];
}

export class ContractBuilder<
  TInputSchema extends AnySchema | undefined = undefined,
  TOutputSchema extends AnySchema | undefined = undefined,
  TErrorMap extends ErrorMap = Record<never, never>,
  TMeta extends Meta = Record<never, never>,
> extends ContractProcedure<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  declare readonly "~katman": ContractBuilderDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;

  // --- Schema Methods ---

  input<TSchema extends AnySchema>(
    schema: TSchema,
  ): ContractBuilder<TSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this["~katman"],
      inputSchema: schema,
    });
  }

  output<TSchema extends AnySchema>(
    schema: TSchema,
  ): ContractBuilder<TInputSchema, TSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this["~katman"],
      outputSchema: schema,
    });
  }

  // --- Metadata Methods ---

  errors<T extends Record<string, ErrorMapItem<AnySchema> | undefined>>(
    errors: T,
  ): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap & T, TMeta> {
    return new ContractBuilder({
      ...this["~katman"],
      errorMap: mergeErrorMap(this["~katman"].errorMap, errors) as TErrorMap & T,
    });
  }

  meta<T extends Meta>(meta: T): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta & T> {
    return new ContractBuilder({
      ...this["~katman"],
      meta: mergeMeta(this["~katman"].meta, meta) as TMeta & T,
    });
  }

  route(route: Route): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this["~katman"],
      route: mergeRoute(this["~katman"].route, route),
    });
  }

  // --- Router Methods ---

  prefix(prefix: string): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this["~katman"],
      prefix: mergePrefix(this["~katman"].prefix, prefix),
    });
  }

  tag(...tags: string[]): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({
      ...this["~katman"],
      tags: mergeTags(this["~katman"].tags, tags),
    });
  }

  /**
   * Apply accumulated prefix/tags/errors to a router tree.
   */
  router<T extends AnyContractRouter>(router: T): T {
    return enhanceContractRouter(router, {
      errorMap: this["~katman"].errorMap,
      prefix: this["~katman"].prefix,
      tags: this["~katman"].tags,
    }) as T;
  }

  // --- Dollar methods (reset) ---

  $meta<T extends Meta>(meta: T): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, T> {
    return new ContractBuilder({ ...this["~katman"], meta });
  }

  $route(route: Route): ContractBuilder<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({ ...this["~katman"], route });
  }

  $input<TSchema extends AnySchema>(
    schema: TSchema,
  ): ContractBuilder<TSchema, TOutputSchema, TErrorMap, TMeta> {
    return new ContractBuilder({ ...this["~katman"], inputSchema: schema });
  }
}

function enhanceContractRouter(
  router: AnyContractRouter,
  options: { errorMap?: ErrorMap; prefix?: string; tags?: string[] },
): AnyContractRouter {
  if (isContractProcedure(router)) {
    const def = router["~katman"];
    return new ContractProcedure({
      ...def,
      errorMap: options.errorMap ? mergeErrorMap(options.errorMap, def.errorMap) : def.errorMap,
      route: enhanceRoute(def.route, {
        prefix: options.prefix,
        tags: options.tags,
      }),
    });
  }

  const result: Record<string, AnyContractRouter> = {};
  for (const [key, child] of Object.entries(router as Record<string, AnyContractRouter>)) {
    result[key] = enhanceContractRouter(child, options);
  }
  return result;
}

/** The singleton entry point */
export const kc = new ContractBuilder({
  errorMap: {} as Record<never, never>,
  route: {},
  meta: {} as Record<never, never>,
});
