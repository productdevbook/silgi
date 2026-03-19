import { describe, it, expect } from 'vitest'

import { createSerializer } from '#src/plugins/custom-serializer.ts'

describe('Custom serializer', () => {
  it('serializes and deserializes custom types', () => {
    // Use a type that JSON.stringify doesn't handle natively
    const s = createSerializer().register('BigInt', {
      test: (v) => typeof v === 'bigint',
      serialize: (v: bigint) => v.toString(),
      deserialize: (v) => BigInt(v as string),
    })

    const data = { count: 42n }
    const json = s.stringify(data)
    expect(json).toContain('__$type')
    expect(json).toContain('BigInt')

    const parsed = s.parse(json) as typeof data
    expect(typeof parsed.count).toBe('bigint')
    expect(parsed.count).toBe(42n)
  })
})
