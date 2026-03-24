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

export { withInterceptors, type ClientInterceptors } from './interceptor.ts'

export { SilgiError, isDefinedError } from '../core/error.ts'
export type { SilgiErrorCode, SilgiErrorJSON } from '../core/error.ts'
