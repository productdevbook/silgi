/**
 * misina-based RPC transport — silgi client link.
 *
 * Thin shim over a misina instance. The adapter owns four things — and
 * nothing else:
 *
 *   1. URL construction from the path tuple
 *   2. Protocol negotiation (json / messagepack / devalue) — sets
 *      content-type/accept and encodes the body accordingly
 *   3. Per-call `responseType: 'stream'` override so SSE subscription
 *      responses can be decoded lazily
 *   4. SilgiError lifting from the response payload, plus mapping
 *      misina's HTTPError / NetworkError / TimeoutError onto SilgiError
 *
 * Everything else — retry, timeout, hooks, idempotency, redirect policy,
 * plugins (cache, breaker, dedupe, cookies, auth, otel, …) — lives on the
 * misina instance you pass in. Configure misina once with
 * `createMisina({ baseURL, retry, use: [plugin(), …] })` and hand the
 * result here.
 *
 * @example
 * ```ts
 * import { createMisina } from "misina"
 * import { cache } from "misina/cache"
 * import { breaker } from "misina/breaker"
 * import { bearer } from "misina/auth"
 * import { createClient } from "silgi/client"
 * import { createLink } from "silgi/client/misina"
 *
 * const url = "http://localhost:3000"
 *
 * const link = createLink({
 *   url,
 *   misina: createMisina({
 *     baseURL: url,
 *     retry: 3,
 *     idempotencyKey: "auto",
 *     use: [
 *       bearer(() => store.token),
 *       cache({ ttl: 60_000 }),
 *       breaker({ failureThreshold: 5, windowMs: 30_000 }),
 *     ],
 *   }),
 * })
 *
 * const client = createClient<AppRouter>(link)
 * ```
 *
 * If `misina` is omitted, the adapter constructs a minimal default
 * instance (`createMisina({ baseURL })`). That's fine for plain RPC; opt
 * into retries, plugins, hooks, etc. by passing your own instance.
 */

import { createMisina, isHTTPError, isNetworkError, isTimeoutError } from 'misina'

import { encode as msgpackEncode, decode as msgpackDecode, MSGPACK_CONTENT_TYPE } from '../../../codec/msgpack.ts'
import { SilgiError, isSilgiErrorJSON, fromSilgiErrorJSON } from '../../../core/error.ts'
import { eventStreamToIterator } from '../../../core/sse.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'
import type { Misina } from 'misina'

export interface LinkOptions<TClientContext extends ClientContext = ClientContext> {
  /** Server base URL (e.g. "http://localhost:3000"). */
  url: string

  /**
   * Misina instance the adapter dispatches through. Configure retry,
   * timeout, hooks, plugins (`use: [...]`), idempotency keys, redirect
   * policy, custom drivers, etc. on this instance — the adapter does not
   * accept those options directly.
   *
   * If omitted, the adapter calls `createMisina({ baseURL: url })`. Pass
   * your own instance to opt into anything beyond default fetch behavior.
   */
  misina?: Misina

  /**
   * Wire protocol for request/response encoding.
   *
   * - `'json'` — default, standard JSON
   * - `'messagepack'` — 2–4× faster, ~50% smaller payloads
   * - `'devalue'` — preserves Date, Map, Set, BigInt, circular refs
   *
   * @default 'json'
   */
  protocol?: 'json' | 'messagepack' | 'devalue'

  /**
   * Static headers or a per-call factory. Headers configured on the
   * misina instance still apply; these are merged on top per call.
   */
  headers?:
    | HeadersInit
    | Record<string, string | undefined>
    | ((options: ClientOptions<TClientContext>) => HeadersInit | Record<string, string | undefined>)
}

/**
 * Create a Silgi client link powered by misina.
 *
 * @see {@link LinkOptions} for the full shape and the misina-instance
 * pattern.
 */
export function createLink<TClientContext extends ClientContext = ClientContext>(
  options: LinkOptions<TClientContext>,
): ClientLink<TClientContext> {
  const baseUrl = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
  const protocol: 'json' | 'messagepack' | 'devalue' = options.protocol ?? 'json'
  // Default instance — minimal, no retry, no plugins. Users opting into
  // any transport-shaping behavior pass their own.
  const misina = options.misina ?? createMisina({ baseURL: baseUrl })

  return {
    async call(path, input, callOptions) {
      // Always send a fully-qualified URL. The user's misina instance
      // may or may not have baseURL set; the adapter doesn't depend on it.
      const url = `${baseUrl}/${path.map(encodeURIComponent).join('/')}`

      const headers = resolveHeaders(options.headers, callOptions)

      let body: unknown
      if (protocol === 'messagepack') {
        headers['content-type'] = MSGPACK_CONTENT_TYPE
        headers['accept'] = MSGPACK_CONTENT_TYPE
        body = input !== undefined && input !== null ? msgpackEncode(input) : undefined
      } else if (protocol === 'devalue') {
        const { encode: devalueEncode, DEVALUE_CONTENT_TYPE } = await import('../../../codec/devalue.ts')
        headers['content-type'] = DEVALUE_CONTENT_TYPE
        headers['accept'] = DEVALUE_CONTENT_TYPE
        body = input !== undefined && input !== null ? devalueEncode(input) : undefined
      } else {
        body = input !== undefined && input !== null ? input : undefined
      }

      try {
        // Per-call overrides win over instance defaults — the adapter must
        // own `responseType: 'stream'` (so SSE subscriptions can be decoded
        // lazily and protocol-encoded responses can be drained on our
        // schedule) and `throwHttpErrors: false` (we lift HTTPError into
        // SilgiError ourselves and never want misina to swallow the body).
        const result = await misina.post(url, body, {
          headers,
          signal: callOptions.signal,
          responseType: 'stream',
          throwHttpErrors: false,
        })

        const response = result.raw

        // Subscription — server emitted an async iterator as SSE.
        const responseContentType = response.headers.get('content-type') ?? ''
        if (responseContentType.includes('text/event-stream') && response.body) {
          return eventStreamToIterator(response.body)
        }

        // Query/mutation — drain and decode per protocol.
        let decoded: unknown
        if (protocol === 'messagepack') {
          const buf = new Uint8Array(await response.arrayBuffer())
          decoded = buf.length > 0 ? msgpackDecode(buf) : undefined
        } else if (protocol === 'devalue') {
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
        if (error instanceof SilgiError) throw error

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

function resolveHeaders<TClientContext extends ClientContext>(
  headers: LinkOptions<TClientContext>['headers'],
  callOptions: ClientOptions<TClientContext>,
): Record<string, string> {
  const raw = typeof headers === 'function' ? headers(callOptions) : headers
  const out: Record<string, string> = {}
  if (raw == null) return out

  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key] = value
    })
    return out
  }

  if (Array.isArray(raw)) {
    for (const [k, v] of raw) {
      if (v == null) continue
      out[k] = String(v)
    }
    return out
  }

  for (const [k, v] of Object.entries(raw as Record<string, string | undefined>)) {
    if (v == null) continue
    out[k] = String(v)
  }
  return out
}

// Re-export the `Misina` type so callers can write `LinkOptions['misina']`
// or annotate variables without a separate `import from 'misina'`.
export type { Misina } from 'misina'
