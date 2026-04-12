import { describe, expect, it } from 'vitest'

import { parseEmptyableJSON, sequential } from '#src/core/utils.ts'

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
