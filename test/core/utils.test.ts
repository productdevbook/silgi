import { describe, expect, it } from 'vitest'

import { mergeAbortSignals, flattenHeader, parseEmptyableJSON, sequential } from '#src/core/utils.ts'

describe('mergeAbortSignals', () => {
  it('returns undefined for empty array', () => {
    expect(mergeAbortSignals([])).toBeUndefined()
  })

  it('returns the single signal when only one is defined', () => {
    const ac = new AbortController()
    const merged = mergeAbortSignals([ac.signal])
    expect(merged).toBe(ac.signal)
  })

  it('fires when ANY signal aborts (OR-gate), not when all abort', async () => {
    const ac1 = new AbortController()
    const ac2 = new AbortController()
    const merged = mergeAbortSignals([ac1.signal, ac2.signal])!
    expect(merged).toBeDefined()

    // Abort only one signal
    ac1.abort('reason1')

    // Merged should fire immediately (OR-gate behavior)
    await new Promise((r) => setTimeout(r, 10))
    expect(merged.aborted).toBe(true)
  })

  it('merges defined signals when some are undefined (filters undefined)', () => {
    const ac = new AbortController()
    const merged = mergeAbortSignals([ac.signal, undefined])
    // Should still return the defined signal, not undefined
    expect(merged).toBeDefined()
  })

  it('returns aborted signal immediately if any input signal is already aborted', () => {
    const ac1 = new AbortController()
    ac1.abort('already')
    const ac2 = new AbortController()
    const merged = mergeAbortSignals([ac1.signal, ac2.signal])!
    expect(merged).toBeDefined()
    expect(merged.aborted).toBe(true)
  })
})

describe('flattenHeader', () => {
  it('returns undefined for undefined', () => {
    expect(flattenHeader(undefined)).toBeUndefined()
  })

  it('returns string as-is', () => {
    expect(flattenHeader('text/html')).toBe('text/html')
  })

  it('joins array with comma-space', () => {
    expect(flattenHeader(['a', 'b', 'c'])).toBe('a, b, c')
  })
})

describe('parseEmptyableJSON', () => {
  it('returns undefined for empty string', () => {
    expect(parseEmptyableJSON('')).toBeUndefined()
  })

  it('parses valid JSON', () => {
    expect(parseEmptyableJSON('{"a":1}')).toEqual({ a: 1 })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseEmptyableJSON('{broken')).toThrow()
  })
})

describe('sequential', () => {
  it('serializes concurrent calls', async () => {
    const order: number[] = []
    const fn = sequential(async (n: number) => {
      await new Promise((r) => setTimeout(r, 10))
      order.push(n)
      return n
    })

    const [r1, r2, r3] = await Promise.all([fn(1), fn(2), fn(3)])
    expect(r1).toBe(1)
    expect(r2).toBe(2)
    expect(r3).toBe(3)
    expect(order).toEqual([1, 2, 3])
  })
})
