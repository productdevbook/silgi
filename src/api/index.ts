export { katman } from "./katman.ts";
export type {
  KatmanInstance,
  KatmanConfig,
} from "./katman.ts";

export type {
  ProcedureDef,
  ProcedureType,
  ProcedureConfig,
  ErrorDef,
  ErrorDefItem,
  FailFn,
  GuardDef,
  WrapDef,
  GuardFn,
  WrapFn,
  MiddlewareDef,
  ResolveContext,
  RouterDef,
  InferClient,
  InferContextFromUse,
  InferGuardOutput,
} from "./types.ts";

export { compileProcedure, type CompiledHandler } from "./compile.ts";

// Re-exports
export { KatmanError, toKatmanError } from "../core/error.ts";
export { type, validateSchema, ValidationError } from "../core/schema.ts";
