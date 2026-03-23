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

import type { ClientLink, ClientContext, ClientOptions } from '../types.ts'

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

          const delay = getDelay(attempt)
          onRetry?.({ attempt: attempt + 1, delay, error, path })

          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, delay)
            // Cancel wait if signal aborts during delay
            callOptions.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer)
                reject(callOptions.signal!.reason)
              },
              { once: true },
            )
          })
        }
      }
      // Unreachable — loop always throws on last attempt
      throw new Error('Retry exhausted')
    },
  }
}
