/**
 * Client timeout plugin — per-call timeout at the link level.
 *
 * @example
 * ```ts
 * import { withTimeout } from 'silgi/client/plugins'
 *
 * const link = withTimeout(createLink({ url: '/api' }), { timeout: 5000 })
 * ```
 */

import type { ClientLink, ClientContext } from '../types.ts'

export interface TimeoutOptions {
  /** Timeout in ms (default: 30000) */
  timeout?: number
}

export function withTimeout<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: TimeoutOptions = {},
): ClientLink<TClientContext> {
  const timeout = options.timeout ?? 30_000

  return {
    async call(path, input, callOptions) {
      const timeoutSignal = AbortSignal.timeout(timeout)

      // Combine with existing signal if present
      const signal = callOptions.signal
        ? AbortSignal.any([callOptions.signal, timeoutSignal])
        : timeoutSignal

      return link.call(path, input, { ...callOptions, signal })
    },
  }
}
