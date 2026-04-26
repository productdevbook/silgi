/**
 * misina-based RPC transport — v2 client link.
 *
 * Uses misina for: retry (with Retry-After parsing), timeout, full hook
 * lifecycle (init / beforeRequest / beforeRetry / beforeRedirect /
 * afterResponse / beforeError / onComplete), redirect security policy,
 * NetworkError vs HTTPError taxonomy, idempotency keys for retried
 * mutations, RFC 9457 problem+json, validateResponse, decompress, body
 * timeout, fetch priority, custom driver.
 *
 * Side-by-side alternative to the ofetch link. Same Silgi semantics,
 * different transport. Pick whichever fits your stack.
 *
 * For plugin composition (cache, circuit breaker, dedupe, cookie jar,
 * auth/refresh, csrf), pass a pre-wrapped misina instance via the
 * `misina` option:
 *
 * ```ts
 * import { createMisina } from "misina"
 * import { withCache, memoryStore } from "misina/cache"
 * import { withCircuitBreaker } from "misina/breaker"
 * import { withBearer, withRefreshOn401 } from "misina/auth"
 *
 * const cached = withCache(createMisina({ baseURL }), { store: memoryStore() })
 * const guarded = withCircuitBreaker(cached, { failureThreshold: 5, windowMs: 30_000 })
 * const authed = withRefreshOn401(withBearer(guarded, () => token), { refresh: getNewToken })
 *
 * const link = createLink({ url: baseURL, misina: authed })
 * ```
 */

import { createMisina, isHTTPError, isNetworkError, isTimeoutError } from 'misina'

import { encode as msgpackEncode, decode as msgpackDecode, MSGPACK_CONTENT_TYPE } from '../../../codec/msgpack.ts'
import { SilgiError, isSilgiErrorJSON, fromSilgiErrorJSON } from '../../../core/error.ts'
import { eventStreamToIterator } from '../../../core/sse.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'
import type {
  AfterResponseHook,
  BeforeErrorHook,
  BeforeRedirectHook,
  BeforeRequestHook,
  BeforeRetryHook,
  InitHook,
  Misina,
  MisinaDriver,
  MisinaHooks,
  MisinaMeta,
  MisinaState,
  RetryOptions,
} from 'misina'

type OnCompleteHook =
  Exclude<MisinaHooks['onComplete'], undefined> extends infer H ? (H extends readonly (infer U)[] ? U : H) : never

type ValidateResponse = (info: {
  status: number
  headers: Headers
  data: unknown
  response: Response
}) => boolean | Error | Promise<boolean | Error>

export interface LinkOptions<TClientContext extends ClientContext = ClientContext> {
  /** Server base URL (e.g. "http://localhost:3000") */
  url: string

  /**
   * Bring-your-own misina instance. When provided, the adapter dispatches
   * through it and ignores the `retry`, `timeout`, `totalTimeout`,
   * `idempotencyKey`, hook, and other transport-shaping options below —
   * configure those on the instance instead. This is the path for
   * plugin composition: `withCache`, `withCircuitBreaker`, `withDedupe`,
   * `withCookieJar`, `withBearer`, `withRefreshOn401`, `withCsrf`.
   *
   * The adapter still owns: URL construction, body encoding, content-type
   * negotiation, SSE branching, and SilgiError lifting from the response.
   */
  misina?: Misina

  /**
   * Static headers or dynamic header factory. Accepts the full set misina
   * supports — Headers instance, [k,v][], or a Record. Values that are
   * `undefined` or `null` are silently dropped (e.g.
   * `{ authorization: token ?? undefined }`).
   */
  headers?:
    | HeadersInit
    | Record<string, string | undefined>
    | ((options: ClientOptions<TClientContext>) =>
        | HeadersInit
        | Record<string, string | undefined>)

  /**
   * Retry policy. Number sets the limit; pass a full `RetryOptions` to
   * tune backoff, status codes, jitter. `false` disables retries.
   *
   * Ignored when `misina` is provided.
   *
   * @default 0
   */
  retry?: number | boolean | RetryOptions

  /** Per-attempt timeout in ms. `false` disables. (default: 30000) */
  timeout?: number | false

  /** Wall-clock deadline across all attempts (ms). `false` disables. */
  totalTimeout?: number | false

  /**
   * Separate cap on response-body read time after headers arrive. Useful
   * when servers send headers fast but stream the body slowly. `false`
   * (default) disables.
   */
  bodyTimeout?: number | false

  /**
   * Byte cap on response payload. Throws `ResponseTooLargeError` if
   * exceeded — first via `Content-Length` fast-path, then via mid-stream
   * counter for chunked responses. `false` (default) disables.
   *
   * Useful as a DoS guard when the server is untrusted or you want to
   * fail fast on malformed payloads.
   */
  maxResponseSize?: number | false

  /**
   * Opt-in response decompression. Most modern runtimes auto-decompress
   * gzip/br at the fetch layer — set this only when you want zstd
   * (Node 23.8+, Workers) or you ship a custom driver that doesn't
   * decompress.
   *
   * - `true` — capability-test all formats
   * - `string[]` — only these formats (e.g. `["zstd"]`)
   * - `false` (default) — leave it to the transport
   */
  decompress?: boolean | readonly ('gzip' | 'deflate' | 'deflate-raw' | 'br' | 'zstd')[]

  /**
   * Compress the request body before dispatch. Symmetrical with
   * `decompress`. Useful when posting large payloads to a server that
   * advertises `Accept-Encoding`. `false` (default) disables.
   */
  compressRequestBody?: boolean | 'gzip' | 'deflate' | 'deflate-raw'

  /**
   * Header names misina scans for the auto-detected request id, surfaced
   * on `MisinaResponse.requestId` and in `HTTPError` messages. Defaults
   * to `['x-request-id', 'request-id', 'x-correlation-id']`.
   */
  requestIdHeaders?: readonly string[]

  /**
   * Header names stripped on cross-origin redirects, in addition to the
   * built-in sensitive set (Authorization, Cookie, Proxy-Authorization,
   * WWW-Authenticate). Use for custom auth headers like `x-api-key`.
   */
  redirectStripHeaders?: string[]

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

  /**
   * Predicate that decides whether a response counts as success. Receives
   * status, headers, parsed body, and raw Response. Return `true` to
   * resolve, `false` to throw `HTTPError`, or an `Error` to throw that
   * error directly. Default: `status >= 200 && status < 300`.
   */
  validateResponse?: ValidateResponse

  /**
   * Redirect handling.
   * - `'manual'` (default): misina follows redirects, applies header policy, fires beforeRedirect.
   * - `'follow'`: hand off to the underlying transport (fast path, no policy).
   * - `'error'`: throw on any 3xx.
   */
  redirect?: 'manual' | 'follow' | 'error'

  /** Headers preserved on cross-origin redirects. Default: accept, accept-encoding, accept-language, user-agent. */
  redirectSafeHeaders?: string[]

  /** Max redirects before throwing. Default: 5. */
  redirectMaxCount?: number

  /** Allow https → http redirect. Default: false. */
  redirectAllowDowngrade?: boolean

  /** Allowlist of URL protocols. Default: `["http","https"]`. Add `'capacitor'`/`'tauri'` for embedded runtimes. */
  allowedProtocols?: readonly string[]

  /** Trailing-slash policy for the final URL. Default: `'preserve'`. */
  trailingSlash?: 'preserve' | 'strip' | 'forbid'

  /** Allow absolute URLs in path segments to override baseURL. Default: true. */
  allowAbsoluteUrls?: boolean

  /** Fetch priority hint. Pass-through to the runtime. */
  priority?: 'high' | 'low' | 'auto'

  /** Standard `fetch` cache mode. */
  cache?: RequestCache

  /** Standard `fetch` credentials mode. Only sent when explicitly set. */
  credentials?: RequestCredentials

  /** Next.js `fetch` extension — `{ revalidate, tags }`. */
  next?: { revalidate?: number | false; tags?: string[] } & Record<string, unknown>

  /** Custom JSON parser. Used by misina for non-protocol responses (HTTPError data, etc). */
  parseJson?: (text: string, ctx?: { request: Request; response: Response }) => unknown

  /** Custom JSON serializer. */
  stringifyJson?: (value: unknown) => string

  /** Per-instance shared, mutable state available to hooks via `ctx.options.state`. */
  state?: MisinaState

  /** Per-request user data. Augment the `MisinaMeta` interface to add typed keys. */
  meta?: MisinaMeta

  /** Override fetch implementation when using the default fetch driver. */
  fetch?: typeof globalThis.fetch

  /** Plug a custom transport (mock for tests, Cloudflare Workers, etc). */
  driver?: MisinaDriver

  /** misina hooks — direct pass-through */
  init?: InitHook
  beforeRequest?: BeforeRequestHook
  beforeRetry?: BeforeRetryHook
  beforeRedirect?: BeforeRedirectHook
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
 *
 * @example
 * ```ts
 * // Bring-your-own instance for plugin composition
 * import { createMisina } from "misina"
 * import { withCache } from "misina/cache"
 * import { withDedupe } from "misina/dedupe"
 *
 * const m = withDedupe(withCache(createMisina({ baseURL })))
 * const link = createLink({ url: baseURL, misina: m })
 * ```
 */
export function createLink<TClientContext extends ClientContext = ClientContext>(
  options: LinkOptions<TClientContext>,
): ClientLink<TClientContext> {
  const baseUrl = options.url.endsWith('/') ? options.url.slice(0, -1) : options.url
  const resolvedProtocol: 'json' | 'messagepack' | 'devalue' = options.protocol ?? 'json'

  // Reuse the user's instance when provided. Otherwise build one with the
  // adapter-side options. The user-instance path is the right answer for
  // plugin composition (cache/breaker/dedupe/cookie/auth) — those plugins
  // wrap a misina with a new dispatch surface, so we have to dispatch
  // through that wrapped instance, not a fresh inner one.
  const misina = options.misina ?? buildMisina(options, baseUrl)

  return {
    async call(path, input, callOptions) {
      // When the user supplied an instance, let its baseURL handle the
      // root and only contribute the path here. Otherwise we own URL
      // construction (and the inner misina has baseURL set already).
      const relativePath = path.map(encodeURIComponent).join('/')

      // Resolve headers — accept HeadersInit, Record, or factory.
      const headers = resolveHeaders(options.headers, callOptions)

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
        const result = await misina.post(relativePath, body, {
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

function buildMisina<TClientContext extends ClientContext>(
  options: LinkOptions<TClientContext>,
  baseUrl: string,
): Misina {
  return createMisina({
    baseURL: baseUrl,
    timeout: options.timeout ?? 30_000,
    totalTimeout: options.totalTimeout,
    bodyTimeout: options.bodyTimeout,
    maxResponseSize: options.maxResponseSize,
    decompress: options.decompress,
    compressRequestBody: options.compressRequestBody,
    requestIdHeaders: options.requestIdHeaders,
    retry: options.retry ?? 0,
    idempotencyKey: options.idempotencyKey,
    throwHttpErrors: false,
    validateResponse: options.validateResponse,
    redirect: options.redirect,
    redirectSafeHeaders: options.redirectSafeHeaders,
    redirectStripHeaders: options.redirectStripHeaders,
    redirectMaxCount: options.redirectMaxCount,
    redirectAllowDowngrade: options.redirectAllowDowngrade,
    allowedProtocols: options.allowedProtocols,
    trailingSlash: options.trailingSlash,
    allowAbsoluteUrls: options.allowAbsoluteUrls,
    priority: options.priority,
    cache: options.cache,
    credentials: options.credentials,
    next: options.next,
    parseJson: options.parseJson,
    stringifyJson: options.stringifyJson,
    state: options.state,
    meta: options.meta,
    fetch: options.fetch,
    driver: options.driver,
    hooks: {
      init: options.init,
      beforeRequest: options.beforeRequest,
      beforeRetry: options.beforeRetry,
      beforeRedirect: options.beforeRedirect,
      afterResponse: options.afterResponse,
      beforeError: options.beforeError,
      onComplete: options.onComplete,
    },
  })
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

// Re-export misina types so callers can wire hooks/retry without a
// separate `import from "misina"`.
export type {
  AfterResponseHook,
  BeforeErrorHook,
  BeforeRedirectHook,
  BeforeRequestHook,
  BeforeRetryHook,
  InitHook,
  Misina,
  MisinaDriver,
  MisinaMeta,
  MisinaState,
  RetryOptions,
} from 'misina'
