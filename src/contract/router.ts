/**
 * Contract router types — nested map of contract procedures.
 */

import type { AnyContractProcedure, ContractProcedure } from "./procedure.ts";
import type { Meta } from "./meta.ts";

/** A router is either a procedure or a nested map */
export type ContractRouter<TMeta extends Meta = Meta> =
  | ContractProcedure<any, any, any, TMeta>
  | { [key: string]: ContractRouter<TMeta> };

export type AnyContractRouter = ContractRouter<any>;

/** Infer all input types from a router */
export type InferContractRouterInputs<T extends AnyContractRouter> =
  T extends ContractProcedure<infer TInput, any, any, any>
    ? TInput
    : T extends Record<string, AnyContractRouter>
      ? { [K in keyof T]: InferContractRouterInputs<T[K]> }
      : never;

/** Infer all output types from a router */
export type InferContractRouterOutputs<T extends AnyContractRouter> =
  T extends ContractProcedure<any, infer TOutput, any, any>
    ? TOutput
    : T extends Record<string, AnyContractRouter>
      ? { [K in keyof T]: InferContractRouterOutputs<T[K]> }
      : never;
