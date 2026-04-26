/**
 * misina-based RPC transport — v2 client link.
 *
 * Uses misina for: retry (with Retry-After parsing), timeout, hook
 * lifecycle, redirect security, NetworkError vs HTTPError taxonomy,
 * idempotency keys for retried mutations.
 *
 * Side-by-side alternative to the ofetch link. Same Silgi semantics,
 * different transport. Pick whichever fits your stack.
 */

import { createMisina, isHTTPError, isNetworkError, isTimeoutError } from 'misina'

import { encode as msgpackEncode, decode as msgpackDecode, MSGPACK_CONTENT_TYPE } from '../../../codec/msgpack.ts'
import { SilgiError, isSilgiErrorJSON, fromSilgiErrorJSON } from '../../../core/error.ts'
import { eventStreamToIterator } from '../../../core/sse.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'
import type { AfterResponseHook, BeforeErrorHook, BeforeRequestHook, MisinaHooks, RetryOptions } from 'misina'

type OnCompleteHook =
  Exclude<MisinaHooks['onComplete'], undefined> extends infer H ? (H extends readonly (infer U)[] ? U : H) : never

export interface LinkOptions<TClientContext extends ClientContext = ClientContext> {
  /** Server base URL (e.g. "http://localhost:3000") */
  url: string

  /** Static headers or dynamic header factory */
  headers?: Record<string, string> | ((options: ClientOptions<TClientContext>) => Record<string, string>)

  /**
   * Retry policy. Number sets the limit; pass a full `RetryOptions` to
   * tune backoff, status codes, jitter. `false` disables retries.
   *
   * @default 0
   */
  retry?: number | boolean | RetryOptions

  /** Per-attempt timeout in ms. `false` disables. (default: 30000) */
  timeout?: number | false

  /** Wall-clock deadline across all attempts (ms). `false` disables. */
  totalTimeout?: number | false

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
   * Auto-generate `Idempotency-Key` for retried mutations. `'auto'` uses
   * `crypto.randomUUID()` when retries are enabled. Pass a string to
   * pin one, or a function for custom generation.
   */
  idempotencyKey?: false | 'auto' | string | ((request: Request) => string)

  /** misina hooks — direct pass-through */
  beforeRequest?: BeforeRequestHook
  afterResponse?: AfterResponseHook
  beforeError?: BeforeErrorHook
  onComplete?: OnCompleteHook
}

/**
 * Create a Silgi client link powered by misina.
 *
 * @example
 * ```ts
 * import { createClient } from "silgi/client"
 * import { createLink } from "silgi/client/misina"
 *
 * const link = createLink({ url: "http://localhost:3000" })
 * const client = createClient<AppRouter>(link)
 * const users = await client.users.list({ limit: 10 })
 * ```
 */
export function createLink<TClientContext extends ClientContext = ClientContext>(
  options: LinkOptions<TClientContext>,
): ClientLink<TClientContext> {
  const baseUrl = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
  const resolvedProtocol: 'json' | 'messagepack' | 'devalue' = options.protocol ?? 'json'

  const misina = createMisina({
    timeout: options.timeout ?? 30_000,
    totalTimeout: options.totalTimeout,
    retry: options.retry ?? 0,
    idempotencyKey: options.idempotencyKey,
    throwHttpErrors: false,
    hooks: {
      beforeRequest: options.beforeRequest,
      afterResponse: options.afterResponse,
      beforeError: options.beforeError,
      onComplete: options.onComplete,
    },
  })

  return {
    async call(path, input, callOptions) {
      const url = `${baseUrl}/${path.map(encodeURIComponent).join('/')}`

      // Resolve headers
      const headers: Record<string, string> = {
        ...(typeof options.headers === 'function' ? options.headers(callOptions) : options.headers),
      }

      // Protocol selection: messagepack > devalue > json (default)
      let body: unknown
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
        // `responseType: 'stream'` keeps misina from consuming the body
        // so we can branch on `content-type`: subscriptions need the
        // raw stream for SSE decoding, while query/mutation responses
        // get decoded here per protocol.
        const result = await misina.post(url, body, {
          headers,
          signal: callOptions.signal,
          responseType: 'stream',
        })

        const response = result.raw

        // Subscription response — server emitted an async iterator as SSE.
        const responseContentType = response.headers.get('content-type') ?? ''
        if (responseContentType.includes('text/event-stream') && response.body) {
          return eventStreamToIterator(response.body)
        }

        // Query/mutation — drain the stream and decode per protocol.
        let decoded: unknown
        if (resolvedProtocol === 'messagepack') {
          const buf = new Uint8Array(await response.arrayBuffer())
          decoded = buf.length > 0 ? msgpackDecode(buf) : undefined
        } else if (resolvedProtocol === 'devalue') {
          const text = await response.text()
          if (text) {
            const { decode: devalueDecode } = await import('../../../codec/devalue.ts')
            decoded = devalueDecode(text)
          } else {
            decoded = undefined
          }
        } else {
          const text = await response.text()
          if (!text) {
            decoded = undefined
          } else {
            try {
              decoded = JSON.parse(text)
            } catch {
              decoded = text
            }
          }
        }

        if (isSilgiErrorJSON(decoded)) {
          throw fromSilgiErrorJSON(decoded as any)
        }

        return decoded
      } catch (error) {
        // Re-throw SilgiError as-is
        if (error instanceof SilgiError) throw error

        // misina HTTPError carries server payload — try to lift SilgiError shape
        if (isHTTPError(error)) {
          const data = (error as any).data
          if (isSilgiErrorJSON(data)) {
            throw fromSilgiErrorJSON(data)
          }
          throw new SilgiError('INTERNAL_SERVER_ERROR', {
            status: (error as any).status ?? 500,
            message: (error as Error).message,
            data,
          })
        }

        if (isNetworkError(error) || isTimeoutError(error)) {
          throw new SilgiError('INTERNAL_SERVER_ERROR', {
            status: 0,
            message: (error as Error).message,
          })
        }

        throw error
      }
    },
  }
}
