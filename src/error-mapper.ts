/**
 * mapDomainErrors — convert service-layer errors into SilgiError.
 *
 * @remarks
 * Library service layers typically throw a domain error (no HTTP
 * knowledge), and route handlers convert them to {@link SilgiError}
 * before returning. Writing the same try/catch wrapper in every
 * resolver is boilerplate; `mapDomainErrors` replaces it with a single
 * mapper function that runs on every thrown error.
 *
 * @example
 * ```ts
 * class DomainError extends Error {
 *   constructor(public code: string, public status: number, message: string) { super(message) }
 * }
 *
 * const toSilgi = mapDomainErrors((e) => {
 *   if (e instanceof DomainError) {
 *     return new SilgiError(e.code, { status: e.status, message: e.message, defined: true })
 *   }
 * })
 *
 * k.$resolve(toSilgi(async ({ input }) => service.doThing(input)))
 * ```
 */

import { SilgiError, isSilgiError } from './core/error.ts'

/**
 * Map a caught error into a {@link SilgiError}, or return `undefined` to
 * rethrow the original error untouched. `SilgiError` instances always
 * pass through unchanged — the mapper is not invoked for them.
 */
export type DomainErrorMapper = (error: unknown) => SilgiError | undefined

/**
 * Create a resolver wrapper that runs `mapper` on every thrown error.
 *
 * @param mapper - Called with the caught error; return a `SilgiError` to
 *   replace it, or `undefined` to rethrow the original.
 * @returns A function that wraps a resolver and applies the mapping.
 *
 * @example
 * ```ts
 * const handleErrors = mapDomainErrors((e) => {
 *   if (e instanceof MyDomainError) {
 *     return new SilgiError(e.code, { status: e.status, message: e.message, defined: true })
 *   }
 * })
 *
 * k.$resolve(handleErrors(async ({ input, ctx }) => {
 *   return await service.run(input, ctx)
 * }))
 * ```
 */
export function mapDomainErrors(mapper: DomainErrorMapper) {
  return function wrap<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  ): (...args: TArgs) => Promise<TReturn> {
    return async (...args: TArgs): Promise<TReturn> => {
      try {
        return await fn(...args)
      } catch (e) {
        if (isSilgiError(e)) throw e
        const mapped = mapper(e)
        if (mapped) throw mapped
        throw e
      }
    }
  }
}
