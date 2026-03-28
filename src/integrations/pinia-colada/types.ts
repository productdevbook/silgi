import type { ClientContext } from '../../client/types.ts'
import type { UseMutationOptions, UseQueryOptions } from '@pinia/colada'
import type { MaybeRefOrGetter } from 'vue'

export type SetOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

export type MaybeOptionalOptions<T> = Partial<T> extends T ? [options?: T] : [options: T]

export type UseQueryFnContext = Parameters<UseQueryOptions<any>['query']>[0]

export type QueryOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TInitialData extends TOutput | undefined,
> = (undefined extends TInput ? { input?: MaybeRefOrGetter<TInput> } : { input: MaybeRefOrGetter<TInput> }) &
  (Record<never, never> extends TClientContext
    ? { context?: MaybeRefOrGetter<TClientContext> }
    : { context: MaybeRefOrGetter<TClientContext> }) &
  SetOptional<QueryOptions<TOutput, TError, TInitialData>, 'key' | 'query'>

export type QueryOptions<TOutput, TError, TInitialData extends TOutput | undefined> = UseQueryOptions<
  TOutput,
  TError,
  TInitialData
>

export type MutationOptionsIn<
  TClientContext extends ClientContext,
  TInput,
  TOutput,
  TError,
  TMutationContext extends Record<any, any>,
> = (Record<never, never> extends TClientContext
  ? { context?: MaybeRefOrGetter<TClientContext> }
  : { context: MaybeRefOrGetter<TClientContext> }) &
  SetOptional<UseMutationOptions<TOutput, TInput, TError, TMutationContext>, 'mutation'>

export type MutationOptions<TInput, TOutput, TError, TMutationContext extends Record<any, any>> = UseMutationOptions<
  TOutput,
  TInput,
  TError,
  TMutationContext
>
