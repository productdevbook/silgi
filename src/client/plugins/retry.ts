/**
 * Client retry plugin.
 */

import type { ClientLink, ClientContext, ClientOptions } from '../types.ts'

export interface RetryOptions {
  maxRetries?: number
  retryDelay?: number | ((attempt: number) => number)
  shouldRetry?: (error: unknown) => boolean
}

export function withRetry<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: RetryOptions = {},
): ClientLink<TClientContext> {
  const maxRetries = options.maxRetries ?? 3
  const getDelay =
    typeof options.retryDelay === 'function' ? options.retryDelay : () => (options.retryDelay as number) ?? 1000
  const shouldRetry = options.shouldRetry ?? (() => true)

  return {
    async call(path, input, callOptions) {
      let lastError: unknown
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await link.call(path, input, callOptions)
        } catch (error) {
          lastError = error
          if (attempt === maxRetries || !shouldRetry(error)) throw error
          if (callOptions.signal?.aborted) throw error
          const delay = getDelay(attempt)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
      throw lastError
    },
  }
}
