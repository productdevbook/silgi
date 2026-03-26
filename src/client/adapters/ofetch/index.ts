/**
 * ofetch-based RPC transport — v2 client link.
 *
 * Uses ofetch for: retry, timeout, interceptors, auto-JSON.
 * Replaces manual fetch + retry/dedupe plugins with a single link.
 */

import { ofetch, FetchError } from 'ofetch'

import { encode as msgpackEncode, decode as msgpackDecode, MSGPACK_CONTENT_TYPE } from '../../../codec/msgpack.ts'
import { SilgiError, isSilgiErrorJSON, fromSilgiErrorJSON } from '../../../core/error.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'
import type { FetchOptions, FetchContext } from 'ofetch'

export interface SilgiLinkOptions<TClientContext extends ClientContext = ClientContext> {
  /** Server base URL (e.g. "http://localhost:3000") */
  url: string

  /** Static headers or dynamic header factory */
  headers?: Record<string, string> | ((options: ClientOptions<TClientContext>) => Record<string, string>)

  /** Retry count for failed requests (default: 1 for queries, 0 for mutations) */
  retry?: number | false

  /** Retry delay in ms, or function for backoff (default: 0) */
  retryDelay?: number | ((ctx: FetchContext) => number)

  /** Timeout in ms (default: 30000) */
  timeout?: number

  /**
   * Wire protocol for request/response encoding.
   *
   * - `'json'` — default, standard JSON
   * - `'messagepack'` — 2-4x faster, ~50% smaller payloads
   * - `'devalue'` — preserves Date, Map, Set, BigInt, circular refs
   *
   * @default 'json'
   */
  protocol?: 'json' | 'messagepack' | 'devalue'

  /**
   * @deprecated Use `protocol: 'messagepack'` instead.
   */
  binary?: boolean

  /**
   * @deprecated Use `protocol: 'devalue'` instead.
   */
  devalue?: boolean

  /** ofetch interceptors */
  onRequest?: FetchOptions['onRequest']
  onResponse?: FetchOptions['onResponse']
  onRequestError?: FetchOptions['onRequestError']
  onResponseError?: FetchOptions['onResponseError']
}

/**
 * Create a Silgi client link powered by ofetch.
 *
 * @example
 * ```ts
 * import { createClient } from "silgi/client"
 * import { createLink } from "silgi/client/ofetch"
 *
 * const link = createLink({ url: "http://localhost:3000" })
 * const client = createClient<AppRouter>(link)
 * const users = await client.users.list({ limit: 10 })
 * ```
 */
export function createLink<TClientContext extends ClientContext = ClientContext>(
  options: SilgiLinkOptions<TClientContext>,
): ClientLink<TClientContext> {
  const baseUrl = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
  const defaultTimeout = options.timeout ?? 30_000
  const defaultRetry = options.retry
  const defaultRetryDelay = options.retryDelay ?? 0
  // Resolve protocol — new `protocol` field takes precedence over deprecated booleans
  const resolvedProtocol: 'json' | 'messagepack' | 'devalue' = options.protocol
    ?? (options.binary ? 'messagepack' : undefined)
    ?? (options.devalue ? 'devalue' : undefined)
    ?? 'json'

  return {
    async call(path, input, callOptions) {
      const urlPath = path.map(encodeURIComponent).join('/')
      const url = `${baseUrl}/${urlPath}`

      // Resolve headers
      const headers: Record<string, string> = {
        ...(typeof options.headers === 'function' ? options.headers(callOptions) : options.headers),
      }

      // Protocol selection: messagepack > devalue > json (default)
      let body: any
      if (resolvedProtocol === 'messagepack') {
        headers['content-type'] = MSGPACK_CONTENT_TYPE
        headers['accept'] = MSGPACK_CONTENT_TYPE
        body = input !== undefined && input !== null ? msgpackEncode(input) : undefined
      } else if (resolvedProtocol === 'devalue') {
        const { encode: devalueEncode, DEVALUE_CONTENT_TYPE } = await import('../../../codec/devalue.ts')
        headers['content-type'] = DEVALUE_CONTENT_TYPE
        headers['accept'] = DEVALUE_CONTENT_TYPE
        body = input !== undefined && input !== null ? devalueEncode(input) : undefined
      } else {
        body = input !== undefined && input !== null ? input : undefined
      }

      try {
        const data = await ofetch(url, {
          method: 'POST',
          headers,
          body,
          signal: callOptions.signal,
          timeout: defaultTimeout,
          retry: defaultRetry ?? 0,
          retryDelay: defaultRetryDelay,
          ignoreResponseError: true,
          onRequest: options.onRequest,
          onResponse: options.onResponse,
          onRequestError: options.onRequestError,
          onResponseError: options.onResponseError,
          // Response handling per protocol
          ...(resolvedProtocol === 'messagepack'
            ? { responseType: 'arrayBuffer' as const }
            : resolvedProtocol === 'devalue'
              ? { responseType: 'text' as const }
              : {
                  parseResponse(text: string) {
                    if (!text) return undefined
                    try {
                      return JSON.parse(text)
                    } catch {
                      return text
                    }
                  },
                }),
        })

        // Decode response
        let decoded: unknown
        if (resolvedProtocol === 'messagepack') {
          decoded = msgpackDecode(new Uint8Array(data as ArrayBuffer))
        } else if (resolvedProtocol === 'devalue') {
          const { decode: devalueDecode } = await import('../../../codec/devalue.ts')
          decoded = data ? devalueDecode(data as string) : undefined
        } else {
          decoded = data
        }

        if (isSilgiErrorJSON(decoded)) {
          throw fromSilgiErrorJSON(decoded as any)
        }

        return decoded
      } catch (error) {
        // Re-throw SilgiError as-is
        if (error instanceof SilgiError) throw error

        // Convert FetchError to SilgiError
        if (error instanceof FetchError) {
          const responseData = error.data
          if (isSilgiErrorJSON(responseData)) {
            throw fromSilgiErrorJSON(responseData)
          }
          throw new SilgiError('INTERNAL_SERVER_ERROR', {
            status: error.status ?? 500,
            message: error.message,
            data: responseData,
          })
        }

        throw error
      }
    },
  }
}
