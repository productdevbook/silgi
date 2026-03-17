export { createClient, safe } from "./client.ts";
export type { SafeResult } from "./client.ts";
export type {
  ClientContext, ClientOptions, Client, ClientRest,
  NestedClient, ClientLink, InferClientInputs, InferClientOutputs,
} from "./types.ts";
export { DynamicLink, type LinkResolver } from "./dynamic-link.ts";

// Re-exports from core
export { KatmanError, isDefinedError } from "../core/error.ts";
export type { KatmanErrorCode, KatmanErrorJSON } from "../core/error.ts";
