import { describe, expect, it, vi } from 'vitest'

import { withCircuitBreaker, CircuitBreakerOpenError } from '#src/client/plugins/circuit-breaker'
import { withRetry } from '#src/client/plugins/retry'
import { withTimeout } from '#src/client/plugins/timeout'

import type { ClientLink } from '#src/client/types'

// ── Helpers ──

function mockLink(responses: Array<{ value?: unknown; error?: unknown }>): ClientLink {
  let callIndex = 0
  return {
    async call() {
      const r = responses[callIndex++]
      if (!r) throw new Error('No more responses')
      if (r.error) throw r.error
      return r.value
    },
  }
}

function errorWithStatus(status: number, message = 'error'): Error & { status: number } {
  const err = new Error(message) as Error & { status: number }
  err.status = status
  return err
}

// ── withRetry ──

describe('withRetry', () => {
  it('returns on first success', async () => {
    const link = mockLink([{ value: 'ok' }])
    const retryLink = withRetry(link)
    expect(await retryLink.call(['test'], undefined, {})).toBe('ok')
  })

  it('retries on failure then succeeds', async () => {
    const link = mockLink([{ error: errorWithStatus(500) }, { error: errorWithStatus(502) }, { value: 'recovered' }])
    const retryLink = withRetry(link, { baseDelay: 10 })
    expect(await retryLink.call(['test'], undefined, {})).toBe('recovered')
  })

  it('throws after maxRetries exhausted', async () => {
    const link = mockLink([
      { error: errorWithStatus(500) },
      { error: errorWithStatus(500) },
      { error: errorWithStatus(500) },
      { error: errorWithStatus(500) },
    ])
    const retryLink = withRetry(link, { maxRetries: 2, baseDelay: 10 })
    await expect(retryLink.call(['test'], undefined, {})).rejects.toThrow()
  })

  it('does not retry on non-retryable status codes', async () => {
    const link = mockLink([{ error: errorWithStatus(400) }])
    const retryLink = withRetry(link, { baseDelay: 10 })
    await expect(retryLink.call(['test'], undefined, {})).rejects.toThrow()
  })

  it('retries network errors (no status)', async () => {
    const link = mockLink([{ error: new Error('fetch failed') }, { value: 'ok' }])
    const retryLink = withRetry(link, { baseDelay: 10 })
    expect(await retryLink.call(['test'], undefined, {})).toBe('ok')
  })

  it('respects custom retryOn status codes', async () => {
    const link = mockLink([{ error: errorWithStatus(418) }, { value: 'ok' }])
    const retryLink = withRetry(link, { retryOn: [418], baseDelay: 10 })
    expect(await retryLink.call(['test'], undefined, {})).toBe('ok')
  })

  it('respects shouldRetry predicate', async () => {
    const link = mockLink([{ error: errorWithStatus(500) }, { value: 'never reached' }])
    const retryLink = withRetry(link, {
      baseDelay: 10,
      shouldRetry: () => false,
    })
    await expect(retryLink.call(['test'], undefined, {})).rejects.toThrow()
  })

  it('calls onRetry callback', async () => {
    const onRetry = vi.fn()
    const link = mockLink([{ error: errorWithStatus(500) }, { value: 'ok' }])
    const retryLink = withRetry(link, { baseDelay: 10, onRetry })
    await retryLink.call(['users', 'list'], undefined, {})
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        path: ['users', 'list'],
      }),
    )
  })

  it('uses exponential backoff', async () => {
    const delays: number[] = []
    const link = mockLink([{ error: errorWithStatus(500) }, { error: errorWithStatus(500) }, { value: 'ok' }])
    const retryLink = withRetry(link, {
      baseDelay: 100,
      jitter: false,
      onRetry: ({ delay }) => delays.push(delay),
    })
    await retryLink.call(['test'], undefined, {})
    expect(delays[0]).toBe(100) // 100 * 2^0
    expect(delays[1]).toBe(200) // 100 * 2^1
  })

  it('stops retrying on abort', async () => {
    const link = mockLink([{ error: errorWithStatus(500) }, { error: errorWithStatus(500) }])
    const controller = new AbortController()
    controller.abort()
    const retryLink = withRetry(link, { baseDelay: 10 })
    await expect(retryLink.call(['test'], undefined, { signal: controller.signal })).rejects.toThrow()
  })

  it('accepts custom delay function', async () => {
    const link = mockLink([{ error: errorWithStatus(500) }, { value: 'ok' }])
    const retryLink = withRetry(link, { baseDelay: () => 5 })
    expect(await retryLink.call(['test'], undefined, {})).toBe('ok')
  })

  it('does not leak abort listeners on long-lived signals', async () => {
    // Simulate a page-level AbortController reused across many retry waves.
    // Prior impl added a new `abort` listener on every retry and never
    // removed them when the retry timer fired, so the signal slowly
    // accumulated listeners.
    const controller = new AbortController()
    const addSpy = vi.spyOn(controller.signal, 'addEventListener')
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')

    // 3 retries per call → 3 adds + 3 removes per call.
    for (let i = 0; i < 3; i++) {
      const link = mockLink([
        { error: errorWithStatus(500) },
        { error: errorWithStatus(500) },
        { error: errorWithStatus(500) },
        { value: 'ok' },
      ])
      const retryLink = withRetry(link, { baseDelay: 1, jitter: false, maxRetries: 3 })
      await retryLink.call(['test'], undefined, { signal: controller.signal })
    }

    // Each retry adds exactly one listener and removes it on timer fire —
    // net adds must equal net removes.
    const abortAdds = addSpy.mock.calls.filter(([ev]) => ev === 'abort').length
    const abortRemoves = removeSpy.mock.calls.filter(([ev]) => ev === 'abort').length
    expect(abortAdds).toBeGreaterThan(0)
    expect(abortRemoves).toBe(abortAdds)
  })
})

// ── withCircuitBreaker ──

describe('withCircuitBreaker', () => {
  it('passes through when closed', async () => {
    const link = mockLink([{ value: 'ok' }])
    const cb = withCircuitBreaker(link)
    expect(await cb.call(['test'], undefined, {})).toBe('ok')
    expect(cb.getState()).toBe('closed')
  })

  it('opens after failure threshold', async () => {
    const errors = Array.from({ length: 5 }, () => ({ error: new Error('fail') }))
    const link = mockLink(errors)
    const cb = withCircuitBreaker(link, { failureThreshold: 5 })

    for (let i = 0; i < 5; i++) {
      await expect(cb.call(['test'], undefined, {})).rejects.toThrow('fail')
    }
    expect(cb.getState()).toBe('open')
  })

  it('rejects immediately when open', async () => {
    const link = mockLink(Array.from({ length: 6 }, () => ({ error: new Error('fail') })))
    const cb = withCircuitBreaker(link, { failureThreshold: 3, resetTimeout: 60000 })

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(['test'], undefined, {})).rejects.toThrow()
    }
    await expect(cb.call(['test'], undefined, {})).rejects.toThrow(CircuitBreakerOpenError)
  })

  it('resets to closed after success', async () => {
    const link = mockLink([{ error: new Error('fail') }, { error: new Error('fail') }, { value: 'ok' }])
    const cb = withCircuitBreaker(link, { failureThreshold: 5 })

    await expect(cb.call(['test'], undefined, {})).rejects.toThrow()
    await expect(cb.call(['test'], undefined, {})).rejects.toThrow()
    await cb.call(['test'], undefined, {})
    expect(cb.getState()).toBe('closed')
  })

  it('calls onStateChange', async () => {
    const onStateChange = vi.fn()
    const link = mockLink(Array.from({ length: 3 }, () => ({ error: new Error('fail') })))
    const cb = withCircuitBreaker(link, { failureThreshold: 3, onStateChange })

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(['test'], undefined, {})).rejects.toThrow()
    }
    expect(onStateChange).toHaveBeenCalledWith('open', expect.objectContaining({ failures: 3 }))
  })

  it('reset() manually closes circuit', async () => {
    const link = mockLink(Array.from({ length: 4 }, () => ({ error: new Error('fail') })))
    const cb = withCircuitBreaker(link, { failureThreshold: 3 })

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(['test'], undefined, {})).rejects.toThrow()
    }
    expect(cb.getState()).toBe('open')
    cb.reset()
    expect(cb.getState()).toBe('closed')
  })

  it('moves to half-open after resetTimeout', async () => {
    const link = mockLink([...Array.from({ length: 3 }, () => ({ error: new Error('fail') })), { value: 'recovered' }])
    const cb = withCircuitBreaker(link, { failureThreshold: 3, resetTimeout: 10 })

    for (let i = 0; i < 3; i++) {
      await expect(cb.call(['test'], undefined, {})).rejects.toThrow()
    }
    expect(cb.getState()).toBe('open')

    await new Promise((r) => setTimeout(r, 15))
    const result = await cb.call(['test'], undefined, {})
    expect(result).toBe('recovered')
    expect(cb.getState()).toBe('closed')
  })
})

// ── withTimeout ──

describe('withTimeout', () => {
  it('passes through fast calls', async () => {
    const link = mockLink([{ value: 'ok' }])
    const tl = withTimeout(link, { timeout: 5000 })
    expect(await tl.call(['test'], undefined, {})).toBe('ok')
  })

  it('aborts slow calls', async () => {
    const slowLink: ClientLink = {
      async call(_path, _input, options) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 500)
          options.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer)
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
        return 'too slow'
      },
    }
    const tl = withTimeout(slowLink, { timeout: 10 })
    await expect(tl.call(['test'], undefined, {})).rejects.toThrow()
  })
})

// ── Composition ──

describe('plugin composition', () => {
  it('withRetry + withCircuitBreaker + withTimeout compose correctly', async () => {
    const link = mockLink([{ error: errorWithStatus(500) }, { value: 'recovered' }])
    const composed = withRetry(withCircuitBreaker(withTimeout(link, { timeout: 5000 }), { failureThreshold: 10 }), {
      maxRetries: 3,
      baseDelay: 5,
    })
    const result = await composed.call(['test'], undefined, {})
    expect(result).toBe('recovered')
  })
})
