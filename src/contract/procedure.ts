/**
 * ContractProcedure — the schema-first API definition primitive.
 *
 * Each procedure carries its input/output schemas, error map,
 * route metadata, and custom meta — all as types that flow
 * through to the server and client.
 */

import type { AnySchema } from "../core/schema.ts";
import type { ErrorMap } from "./error.ts";
import type { Meta } from "./meta.ts";
import type { Route } from "./route.ts";
import { isErrorStatus } from "../core/error.ts";

export interface ContractProcedureDef<
  TInputSchema extends AnySchema | undefined = AnySchema | undefined,
  TOutputSchema extends AnySchema | undefined = AnySchema | undefined,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> {
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  errorMap: TErrorMap;
  route: Route;
  meta: TMeta;
}

export class ContractProcedure<
  TInputSchema extends AnySchema | undefined = AnySchema | undefined,
  TOutputSchema extends AnySchema | undefined = AnySchema | undefined,
  TErrorMap extends ErrorMap = ErrorMap,
  TMeta extends Meta = Meta,
> {
  readonly "~katman": ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>;

  constructor(def: ContractProcedureDef<TInputSchema, TOutputSchema, TErrorMap, TMeta>) {
    // Validate: success status must not be an error status
    if (def.route.successStatus && isErrorStatus(def.route.successStatus)) {
      throw new Error(`successStatus ${def.route.successStatus} is an error status code`);
    }
    // Validate: error map statuses must be error statuses
    for (const [code, config] of Object.entries(def.errorMap)) {
      if (config?.status && !isErrorStatus(config.status)) {
        throw new Error(`Error '${code}' has non-error status ${config.status}`);
      }
    }
    this["~katman"] = def;
  }
}

export type AnyContractProcedure = ContractProcedure<any, any, any, any>;

/**
 * Duck-typed guard — works across module boundaries.
 */
export function isContractProcedure(item: unknown): item is AnyContractProcedure {
  return (
    typeof item === "object" &&
    item !== null &&
    "~katman" in item &&
    typeof (item as AnyContractProcedure)["~katman"] === "object" &&
    "errorMap" in (item as AnyContractProcedure)["~katman"] &&
    "route" in (item as AnyContractProcedure)["~katman"] &&
    "meta" in (item as AnyContractProcedure)["~katman"]
  );
}
