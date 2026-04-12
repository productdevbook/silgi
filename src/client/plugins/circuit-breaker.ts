/**
 * Client circuit breaker plugin — prevents cascading failures.
 *
 * States:
 * - CLOSED: normal operation, requests pass through
 * - OPEN: too many failures, requests rejected immediately
 * - HALF_OPEN: after reset timeout, one test request allowed
 *
 * @example
 * ```ts
 * import { withCircuitBreaker } from 'silgi/client/plugins'
 *
 * const link = withCircuitBreaker(createLink({ url: '/api' }), {
 *   failureThreshold: 5,
 *   resetTimeout: 30000,
 *   onStateChange: (state) => console.log('Circuit:', state),
 * })
 * ```
 */

import type { ClientLink, ClientContext } from '../types.ts'

export type CircuitState = 'closed' | 'open' | 'half-open'

export class CircuitBreakerOpenError extends Error {
  readonly state: CircuitState = 'open'
  constructor() {
    super('Circuit breaker is open — requests are blocked. Try again later.')
    this.name = 'CircuitBreakerOpenError'
  }
}

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening (default: 5) */
  failureThreshold?: number
  /** Time in ms to wait before moving to half-open (default: 30000) */
  resetTimeout?: number
  /** Called when circuit state changes */
  onStateChange?: (state: CircuitState, info: { failures: number }) => void
}

export function withCircuitBreaker<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: CircuitBreakerOptions = {},
): ClientLink<TClientContext> & { getState: () => CircuitState; reset: () => void } {
  const threshold = options.failureThreshold ?? 5
  const resetTimeout = options.resetTimeout ?? 30_000

  let state: CircuitState = 'closed'
  let failures = 0
  let openedAt = 0
  let probeSent = false

  function setState(newState: CircuitState) {
    if (state !== newState) {
      state = newState
      if (newState !== 'half-open') probeSent = false
      options.onStateChange?.(state, { failures })
    }
  }

  function recordSuccess() {
    failures = 0
    setState('closed')
  }

  function recordFailure() {
    failures++
    if (failures >= threshold) {
      openedAt = Date.now()
      setState('open')
    }
  }

  const wrapper: ClientLink<TClientContext> & { getState: () => CircuitState; reset: () => void } = {
    async call(path, input, callOptions) {
      if (state === 'open') {
        if (Date.now() - openedAt >= resetTimeout) {
          setState('half-open')
        } else {
          throw new CircuitBreakerOpenError()
        }
      }

      // In half-open, only allow one probe request through
      if (state === 'half-open') {
        if (probeSent) throw new CircuitBreakerOpenError()
        probeSent = true
      }

      try {
        const result = await link.call(path, input, callOptions)
        recordSuccess()
        return result
      } catch (error) {
        recordFailure()
        throw error
      }
    },

    getState: () => state,
    reset: () => {
      failures = 0
      probeSent = false
      setState('closed')
    },
  }

  return wrapper
}
