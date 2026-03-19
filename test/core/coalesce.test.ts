import { describe, expect, it, vi } from 'vitest'

import { RequestCoalescer } from '#src/coalesce.ts'

describe('RequestCoalescer', () => {
  it('executes handler for a single request', async () => {
    const coalescer = new RequestCoalescer()
    const result = await coalescer.execute('key1', () => 'hello')
    expect(result).toBe('hello')
  })

  it('coalesces concurrent identical requests into one execution', async () => {
    const coalescer = new RequestCoalescer()
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return '{"data":"ok"}'
    })

    // Fire multiple concurrent requests with the same key
    const [r1, r2, r3] = await Promise.all([
      coalescer.execute('same-key', handler),
      coalescer.execute('same-key', handler),
      coalescer.execute('same-key', handler),
    ])

    // All should get the same result
    expect(r1).toBe('{"data":"ok"}')
    expect(r2).toBe('{"data":"ok"}')
    expect(r3).toBe('{"data":"ok"}')

    // Handler should be called only once
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('propagates errors to all concurrent waiters', async () => {
    const coalescer = new RequestCoalescer()
    const handler = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10))
      throw new Error('db failure')
    })

    const results = await Promise.allSettled([
      coalescer.execute('fail-key', handler),
      coalescer.execute('fail-key', handler),
    ])

    // Both should reject with the same error
    expect(results[0]!.status).toBe('rejected')
    expect(results[1]!.status).toBe('rejected')
    expect((results[0] as PromiseRejectedResult).reason.message).toBe('db failure')
    expect((results[1] as PromiseRejectedResult).reason.message).toBe('db failure')

    // Handler should be called only once
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('executes handler again after previous completes and microtask cleanup', async () => {
    const coalescer = new RequestCoalescer()
    let callCount = 0
    const handler = async () => {
      callCount++
      return `call-${callCount}`
    }

    const r1 = await coalescer.execute('key', handler)
    expect(r1).toBe('call-1')

    // Wait for microtask cleanup
    await new Promise((r) => setTimeout(r, 10))

    const r2 = await coalescer.execute('key', handler)
    expect(r2).toBe('call-2')
  })

  it('tracks inflight count', async () => {
    const coalescer = new RequestCoalescer()
    expect(coalescer.inflightCount).toBe(0)

    const deferred: { resolve: (v: string) => void } = {} as any
    const p = coalescer.execute('key', () => new Promise<string>((r) => (deferred.resolve = r)))

    expect(coalescer.inflightCount).toBe(1)
    deferred.resolve('done')
    await p

    // After microtask cleanup
    await new Promise((r) => setTimeout(r, 10))
    expect(coalescer.inflightCount).toBe(0)
  })

  it('handles different keys independently', async () => {
    const coalescer = new RequestCoalescer()
    const handler1 = vi.fn(async () => 'result-1')
    const handler2 = vi.fn(async () => 'result-2')

    const [r1, r2] = await Promise.all([coalescer.execute('key-a', handler1), coalescer.execute('key-b', handler2)])

    expect(r1).toBe('result-1')
    expect(r2).toBe('result-2')
    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).toHaveBeenCalledTimes(1)
  })
})
