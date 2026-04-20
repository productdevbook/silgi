/**
 * Client retry plugin — exponential backoff with jitter.
 *
 * @example
 * ```ts
 * import { withRetry } from 'silgi/client/plugins'
 *
 * const link = withRetry(createLink({ url: '/api' }), {
 *   maxRetries: 3,
 *   baseDelay: 1000,       // 1s → 2s → 4s
 *   retryOn: [500, 502, 503, 504],
 *   onRetry: ({ attempt, error }) => console.log(`Retry #${attempt}`, error),
 * })
 * ```
 */

import type { ClientLink, ClientContext } from '../types.ts'

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number
  /**
   * Base delay in ms for exponential backoff (default: 1000).
   * Actual delay: `baseDelay * 2^attempt + jitter`
   * Or pass a function: `(attempt: number) => delayMs`
   */
  baseDelay?: number | ((attempt: number) => number)
  /** Add random jitter 0-25% to prevent thundering herd (default: true) */
  jitter?: boolean
  /**
   * HTTP status codes to retry on (default: [408, 429, 500, 502, 503, 504]).
   * Network errors (no status) are always retried unless shouldRetry returns false.
   */
  retryOn?: number[]
  /** Custom retry predicate — return false to stop retrying */
  shouldRetry?: (error: unknown, attempt: number) => boolean
  /** Called before each retry attempt */
  onRetry?: (info: { attempt: number; delay: number; error: unknown; path: readonly string[] }) => void
  /** Respect Retry-After header from 429/503 responses (default: true) */
  respectRetryAfter?: boolean
}

const DEFAULT_RETRY_CODES = [408, 429, 500, 502, 503, 504]

function getStatusFromError(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    if (typeof e.status === 'number') return e.status
    if (typeof e.statusCode === 'number') return e.statusCode
    if (e.response && typeof e.response === 'object') {
      const r = e.response as Record<string, unknown>
      if (typeof r.status === 'number') return r.status
    }
  }
  return undefined
}

/** Parse Retry-After header value — returns delay in ms, or undefined */
function parseRetryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const e = error as Record<string, unknown>
  // Extract header from response.headers or data.headers
  const response = e.response as Record<string, unknown> | undefined
  const headers = (response?.headers ?? e.headers) as Record<string, string> | Headers | undefined
  if (!headers) return undefined
  const value =
    typeof (headers as any).get === 'function'
      ? (headers as Headers).get('retry-after')
      : (headers as Record<string, string>)['retry-after']
  if (!value) return undefined
  // Retry-After can be seconds (integer) or HTTP-date
  const seconds = Number(value)
  if (!Number.isNaN(seconds)) return seconds * 1000
  const date = Date.parse(value)
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now())
  return undefined
}

export function withRetry<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: RetryOptions = {},
): ClientLink<TClientContext> {
  const maxRetries = options.maxRetries ?? 3
  const baseDelay = options.baseDelay ?? 1000
  const useJitter = options.jitter ?? true
  const retryCodes = new Set(options.retryOn ?? DEFAULT_RETRY_CODES)
  const shouldRetry = options.shouldRetry
  const onRetry = options.onRetry
  const respectRetryAfter = options.respectRetryAfter ?? true

  function getDelay(attempt: number): number {
    const base = typeof baseDelay === 'function' ? baseDelay(attempt) : baseDelay * 2 ** attempt
    const jitter = useJitter ? base * Math.random() * 0.25 : 0
    return Math.round(base + jitter)
  }

  function isRetryable(error: unknown, attempt: number): boolean {
    if (shouldRetry && !shouldRetry(error, attempt)) return false
    const status = getStatusFromError(error)
    // No status = network error → retry
    if (status === undefined) return true
    return retryCodes.has(status)
  }

  return {
    async call(path, input, callOptions) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await link.call(path, input, callOptions)
        } catch (error) {
          if (attempt === maxRetries) throw error
          if (callOptions.signal?.aborted) throw error
          if (!isRetryable(error, attempt)) throw error

          const retryAfterDelay = respectRetryAfter ? parseRetryAfter(error) : undefined
          const delay = retryAfterDelay ?? getDelay(attempt)
          onRetry?.({ attempt: attempt + 1, delay, error, path })

          await new Promise<void>((resolve, reject) => {
            const signal = callOptions.signal
            const onAbort = (): void => {
              clearTimeout(timer)
              reject(signal!.reason)
            }
            const timer = setTimeout(() => {
              signal?.removeEventListener('abort', onAbort)
              resolve()
            }, delay)
            // Cancel wait if signal aborts during delay. Explicit
            // `removeEventListener` on the timer path prevents an accumulated
            // listener set on long-lived signals (e.g. page AbortControllers
            // spanning many retries).
            signal?.addEventListener('abort', onAbort, { once: true })
          })
        }
      }
      // Unreachable — loop always throws on last attempt
      throw new Error('Retry exhausted')
    },
  }
}
