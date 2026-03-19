/**
 * Client type definitions.
 */

import type { KatmanError } from '../core/error.ts'

export type ClientContext = Record<PropertyKey, unknown>

export interface ClientOptions<TContext extends ClientContext = ClientContext> {
  signal?: AbortSignal
  lastEventId?: string
  context?: TContext
}

/** A single procedure client — callable function */
export type Client<TClientContext extends ClientContext, TInput, TOutput, TError = KatmanError> = (
  ...args: ClientRest<TClientContext, TInput>
) => Promise<TOutput>

/** Determine argument shape based on input and context optionality */
export type ClientRest<TClientContext extends ClientContext, TInput> = undefined extends TInput
  ? Record<never, never> extends TClientContext
    ? [input?: TInput, options?: ClientOptions<TClientContext>]
    : [input: TInput | undefined, options: ClientOptions<TClientContext>]
  : Record<never, never> extends TClientContext
    ? [input: TInput, options?: ClientOptions<TClientContext>]
    : [input: TInput, options: ClientOptions<TClientContext>]

/** Recursive nested client — mirrors the router structure */
export type NestedClient<TClientContext extends ClientContext = ClientContext> =
  | Client<TClientContext, any, any, any>
  | { [key: string]: NestedClient<TClientContext> }

/** Transport interface — how requests are sent */
export interface ClientLink<TClientContext extends ClientContext = ClientContext> {
  call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown>
}

/** Infer input types from a nested client */
export type InferClientInputs<T extends NestedClient> =
  T extends Client<any, infer TInput, any, any>
    ? TInput
    : T extends Record<string, NestedClient>
      ? { [K in keyof T]: InferClientInputs<T[K]> }
      : never

/** Infer output types from a nested client */
export type InferClientOutputs<T extends NestedClient> =
  T extends Client<any, any, infer TOutput, any>
    ? TOutput
    : T extends Record<string, NestedClient>
      ? { [K in keyof T]: InferClientOutputs<T[K]> }
      : never
