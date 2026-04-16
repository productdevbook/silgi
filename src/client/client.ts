/**
 * Client factory — creates a type-safe proxy client from a link.
 *
 * Sub-proxies are cached in a Map for O(1) repeated access.
 */

import type { InferClient } from '../types.ts'
import type { ClientLink, ClientContext, ClientOptions } from './types.ts'

/**
 * Create a type-safe client from a transport-level {@link ClientLink}.
 *
 * @remarks
 * The returned value is a `Proxy` that mirrors the shape of your server
 * router at the type level. Nested property access builds a dotted
 * procedure path; calling the terminal proxy invokes the link with
 * `(path, input, options)`.
 *
 * Sub-proxies are cached in a `Map` on first access so repeated lookups
 * on the same branch do not re-allocate a new proxy tree.
 *
 * @typeParam T - The inferred server router type (usually
 *   `typeof appRouter`).
 * @typeParam TClientContext - Extra per-call context carried through
 *   `ClientOptions` (e.g. an abort signal, a request id).
 * @param link - A transport link (fetch, ofetch, websocket, custom).
 * @returns A typed client whose shape matches `T`.
 *
 * @example
 * ```ts
 * import { createClient, createFetchLink } from 'silgi/client'
 *
 * const client = createClient<typeof appRouter>(
 *   createFetchLink({ url: 'https://api.example.com' }),
 * )
 * const users = await client.users.list({ limit: 10 })
 * ```
 *
 * @see {@link createSafeClient} for a `[error, data]` variant.
 */
export function createClient<T, TClientContext extends ClientContext = Record<never, never>>(
  link: ClientLink<TClientContext>,
): InferClient<T> {
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

/**
 * Create a safe client — every procedure call returns a {@link SafeResult}
 * tuple instead of throwing.
 *
 * @remarks
 * Useful when the caller prefers discriminated-union error handling over
 * `try`/`catch`. The underlying transport is unchanged; errors are
 * caught by {@link safe} and surfaced as `{ error, data, isError,
 * isSuccess }`.
 *
 * @typeParam T - The inferred server router type.
 * @typeParam TClientContext - Extra per-call context.
 * @param link - A transport link.
 * @returns A client whose every procedure yields a
 *   `Promise<SafeResult<Output, SilgiError>>`.
 *
 * @example
 * ```ts
 * const safeClient = createSafeClient<typeof appRouter>(link)
 * const { error, data } = await safeClient.users.list()
 * if (error) console.error(error.code, error.status)
 * ```
 */
export function createSafeClient<T, TClientContext extends ClientContext = Record<never, never>>(
  link: ClientLink<TClientContext>,
): InferSafeClient<T> {
  return createSafeProxy(link, []) as any
}

function createSafeProxy<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  path: readonly string[],
): unknown {
  const cache = new Map<string, unknown>()

  const procedureClient = (input: unknown, options?: ClientOptions<TClientContext>) =>
    safe(link.call(path, input, options ?? ({} as ClientOptions<TClientContext>)))

  return new Proxy(procedureClient, {
    get(_target, prop) {
      if (prop === 'then') return undefined
      if (typeof prop !== 'string') return undefined
      let cached = cache.get(prop)
      if (!cached) {
        cached = createSafeProxy(link, [...path, prop])
        cache.set(prop, cached)
      }
      return cached
    },
    apply(_target, _thisArg, args) {
      return procedureClient(args[0], args[1])
    },
  })
}

/** Infer a safe client type where every procedure returns SafeResult */
export type InferSafeClient<T> = T extends (...args: infer A) => Promise<infer R>
  ? (...args: A) => Promise<SafeResult<R, import('../core/error.ts').SilgiError>>
  : { [K in keyof T]: InferSafeClient<T[K]> }
