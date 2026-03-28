import { computed, toValue } from 'vue'

import { buildKey } from './key.ts'

import type { Client, ClientContext } from '../../client/types.ts'
import type { MutationOptions, MutationOptionsIn, QueryOptions, QueryOptionsIn } from './types.ts'
import type { MaybeOptionalOptions } from './types.ts'
import type { _EmptyObject } from '@pinia/colada'

export interface ProcedureUtils<TClientContext extends ClientContext, TInput, TOutput, TError> {
  /**
   * Calling corresponding procedure client
   */
  call: Client<TClientContext, TInput, TOutput, TError>

  /**
   * Generate options used for useQuery
   */
  queryOptions<UInitialData extends TOutput | undefined = TOutput | undefined>(
    ...rest: MaybeOptionalOptions<QueryOptionsIn<TClientContext, TInput, TOutput, TError, UInitialData>>
  ): NoInfer<QueryOptions<TOutput, TError, UInitialData>>

  /**
   * Generate options used for useMutation
   */
  mutationOptions<UMutationContext extends Record<any, any> = _EmptyObject>(
    ...rest: MaybeOptionalOptions<MutationOptionsIn<TClientContext, TInput, TOutput, TError, UMutationContext>>
  ): NoInfer<MutationOptions<TInput, TOutput, TError, UMutationContext>>
}

export interface CreateProcedureUtilsOptions {
  path: string[]
}

export function createProcedureUtils<TClientContext extends ClientContext, TInput, TOutput, TError>(
  client: Client<TClientContext, TInput, TOutput, TError>,
  options: CreateProcedureUtilsOptions,
): ProcedureUtils<TClientContext, TInput, TOutput, TError> {
  return {
    call: client,

    queryOptions(...[{ input, context, ...rest } = {} as any]) {
      return {
        key: computed(() => buildKey(options.path, { type: 'query', input: toValue(input) as any })),
        query: ({ signal }: any) => client(toValue(input) as any, { signal, context: toValue(context) as any }),
        ...(rest as any),
      }
    },

    mutationOptions(...[{ context, ...rest } = {} as any]) {
      return {
        key: (input: any) => buildKey(options.path, { type: 'mutation', input: input as any }),
        mutation: (input: any) => client(input, { context: toValue(context) as any }),
        ...(rest as any),
      }
    },
  }
}
