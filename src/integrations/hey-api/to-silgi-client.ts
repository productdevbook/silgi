import type { Client, ClientContext, NestedClient } from '../../client/types.ts'
import type { SilgiError } from '../../core/error.ts'

export type ToSilgiClientResult<T extends Record<string, any>> = {
  [K in keyof T]: T[K] extends (options: infer UInput) => Promise<infer UResult>
    ? Client<
        Record<never, never>,
        UInput,
        {
          body: UResult extends { data: infer USuccess } ? Exclude<USuccess, undefined> : never
          request: Request
          response: Response
        },
        SilgiError
      >
    : T[K] extends Record<string, any>
      ? ToSilgiClientResult<T[K]>
      : never
}

/**
 * Convert a Hey API SDK to a Silgi client.
 *
 * This allows you to use any Hey API generated client with the Silgi
 * ecosystem — including TanStack Query, Pinia Colada, and other integrations.
 */
export function experimental_toSilgiClient<T extends Record<string, any>>(sdk: T): ToSilgiClientResult<T> {
  const client = {} as Record<string, Client<Record<never, never>, undefined | Record<any, any>, any, any>>

  for (const key in sdk) {
    const fn = sdk[key]

    if (!fn || typeof fn !== 'function') {
      continue
    }

    client[key] = async (input, options) => {
      const controller = new AbortController()

      if (input?.signal?.aborted || options?.signal?.aborted) {
        controller.abort()
      } else {
        input?.signal?.addEventListener('abort', () => controller.abort())
        options?.signal?.addEventListener('abort', () => controller.abort())
      }

      const result = await fn({
        ...input,
        signal: controller.signal,
        headers: {
          ...input?.headers,
          ...(typeof options?.lastEventId === 'string' ? { 'last-event-id': options.lastEventId } : {}),
        },
        throwOnError: true,
      })

      return {
        body: result.data,
        request: result.request,
        response: result.response,
      }
    }
  }

  return client as ToSilgiClientResult<T>
}
