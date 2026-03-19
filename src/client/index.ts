export { createClient, safe } from './client.ts'
export type { SafeResult } from './client.ts'
export type {
  ClientContext,
  ClientOptions,
  Client,
  ClientRest,
  NestedClient,
  ClientLink,
  InferClientInputs,
  InferClientOutputs,
} from './types.ts'

export { DynamicLink, type LinkSelector } from './dynamic-link.ts'
export { mergeClients } from './merge.ts'
export { withInterceptors, type ClientInterceptors } from './interceptor.ts'

export { KatmanError, isDefinedError } from '../core/error.ts'
export type { KatmanErrorCode, KatmanErrorJSON } from '../core/error.ts'
