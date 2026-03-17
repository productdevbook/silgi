/**
 * Procedure — a server-side implementation of a contract procedure.
 *
 * Contains: middlewares, handler, schemas, error map, route, meta,
 * and validation indices that tell the compiled pipeline where to
 * insert validation.
 */

import type { AnySchema } from "../core/schema.ts";
import type { AnyMiddleware, Handler } from "../core/pipeline.ts";
import type { ContractProcedureDef } from "../contract/procedure.ts";
import type { ErrorMap } from "../contract/error.ts";
import type { Meta } from "../contract/meta.ts";
import type { Route } from "../contract/route.ts";
import type { Context } from "../core/types.ts";

export interface ProcedureDef<
  TInputSchema extends AnySchema | undefined = AnySchema | undefined,
  TOutputSchema extends AnySchema | undefined = AnySchema | undefined,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> extends ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta> {
  middlewares: readonly AnyMiddleware[];
  handler: Handler;
  inputValidationIndex: number;
  outputValidationIndex: number;
}

export class Procedure<
  TInitialContext extends Context = Context,
  TCurrentContext extends Context = Context,
  TInputSchema extends AnySchema | undefined = AnySchema | undefined,
  TOutputSchema extends AnySchema | undefined = AnySchema | undefined,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> {
  readonly "~katman": ProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;

  constructor(def: ProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>) {
    this["~katman"] = def;
  }
}

export type AnyProcedure = Procedure<any, any, any, any, any, any>;

/**
 * Duck-typed guard — works across realms.
 */
export function isProcedure(item: unknown): item is AnyProcedure {
  if (typeof item !== "object" || item === null) return false;
  if (!("~katman" in item)) return false;
  const def = (item as AnyProcedure)["~katman"];
  return (
    typeof def === "object" &&
    def !== null &&
    "middlewares" in def &&
    "handler" in def &&
    "errorMap" in def
  );
}
