/**
 * Core type definitions for Katman RPC framework.
 */

export type Context = Record<PropertyKey, unknown>

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'
export type HTTPPath = `/${string}`

export interface StandardRequest {
  readonly url: URL
  readonly method: string
  readonly headers: StandardHeaders
  readonly body: StandardBody
  readonly signal: AbortSignal
}

export interface StandardLazyRequest {
  readonly url: URL
  readonly method: string
  readonly headers: StandardHeaders
  readonly body: () => Promise<StandardBody>
  readonly signal: AbortSignal
}

export interface StandardResponse {
  readonly status: number
  readonly headers: StandardHeaders
  readonly body: StandardBody
}

export interface StandardLazyResponse {
  readonly status: number
  readonly headers: StandardHeaders
  readonly body: () => Promise<StandardBody>
}

export type StandardHeaders = Record<string, string | string[] | undefined>
export type StandardBody =
  | undefined
  | unknown
  | Blob
  | File
  | FormData
  | URLSearchParams
  | AsyncIterableIterator<unknown>

export type Value<T, TArgs extends unknown[] = []> = T | ((...args: TArgs) => T)
export type Promisable<T> = T | Promise<T>
export type MaybeOptionalOptions<T> = Record<never, never> extends T ? [options?: T] : [options: T]
export type IntersectPick<T, U> = Pick<T, Extract<keyof T, keyof U>>

export function resolveValue<T, TArgs extends unknown[]>(val: Value<T, TArgs>, ...args: TArgs): T {
  return typeof val === 'function' ? (val as (...args: TArgs) => T)(...args) : val
}
