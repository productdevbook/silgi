/**
 * Client factory — creates a type-safe proxy client from a link.
 *
 * Sub-proxies are cached in a Map for O(1) repeated access.
 */

import type { InferClient } from '../types.ts'
import type { ClientLink, ClientContext, ClientOptions } from './types.ts'

/**
 * Create a type-safe client from a link.
 *
 * Accepts either a router type (auto-inferred) or a pre-inferred client type:
 * ```ts
 * // Recommended — pass AppRouter directly
 * const client = createClient<AppRouter>(link)
 *
 * // Also works — explicit InferClient
 * const client = createClient<InferClient<AppRouter>>(link)
 * ```
 */
export function createClient<T, TClientContext extends ClientContext = Record<never, never>>(
  link: ClientLink<TClientContext>,
): InferClient<T> extends never ? T : InferClient<T> {
  return createClientProxy(link, []) as any
}

function createClientProxy<T, TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  path: readonly string[],
): T {
  // Cache child proxies for O(1) repeated access
  const cache = new Map<string, unknown>()

  const procedureClient = (input: unknown, options?: ClientOptions<TClientContext>) =>
    link.call(path, input, options ?? ({} as ClientOptions<TClientContext>))

  return new Proxy(procedureClient, {
    get(_target, prop) {
      // Prevent native await
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return undefined

      let cached = cache.get(prop)
      if (!cached) {
        cached = createClientProxy(link, [...path, prop])
        cache.set(prop, cached)
      }
      return cached
    },
    apply(_target, _thisArg, args) {
      return procedureClient(args[0], args[1])
    },
  }) as T
}

/**
 * Safe client wrapper — returns [error, data] tuples instead of throwing.
 */
export interface SafeResult<TOutput, TError> {
  error: TError | null
  data: TOutput | undefined
  isError: boolean
  isSuccess: boolean
}

export async function safe<TOutput, TError = unknown>(promise: Promise<TOutput>): Promise<SafeResult<TOutput, TError>> {
  try {
    const data = await promise
    return { error: null, data, isError: false, isSuccess: true }
  } catch (error) {
    return { error: error as TError, data: undefined, isError: true, isSuccess: false }
  }
}
