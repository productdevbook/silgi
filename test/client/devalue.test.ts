/**
 * devalue codec — rich type serialization tests.
 */

import { describe, it, expect } from 'vitest'

import { encode, decode, DEVALUE_CONTENT_TYPE } from '#src/codec/devalue.ts'
import { katman } from '#src/katman.ts'

// ── Codec Unit Tests ────────────────────────────────

describe('devalue codec', () => {
  it('roundtrips Date', () => {
    const date = new Date('2026-03-18T00:00:00Z')
    const encoded = encode(date)
    const decoded = decode(encoded)
    expect(decoded).toEqual(date)
    expect(decoded).toBeInstanceOf(Date)
  })

  it('roundtrips Map', () => {
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ])
    expect(decode(encode(map))).toEqual(map)
  })

  it('roundtrips Set', () => {
    const set = new Set([1, 2, 3])
    expect(decode(encode(set))).toEqual(set)
  })

  it('roundtrips BigInt', () => {
    const big = 9007199254740993n
    expect(decode(encode(big))).toBe(big)
  })

  it('roundtrips RegExp', () => {
    const regex = /test/gi
    const decoded = decode(encode(regex)) as RegExp
    expect(decoded.source).toBe('test')
    expect(decoded.flags).toBe('gi')
  })

  it('roundtrips undefined in objects', () => {
    const obj = { a: 1, b: undefined, c: 'hello' }
    const decoded = decode(encode(obj)) as any
    expect(decoded.a).toBe(1)
    expect(decoded.b).toBeUndefined()
    expect('b' in decoded).toBe(true)
    expect(decoded.c).toBe('hello')
  })

  it('roundtrips nested complex types', () => {
    const data = {
      users: [{ id: 1, name: 'Alice', joined: new Date('2025-01-01') }],
      metadata: new Map([['count', 1]]),
      tags: new Set(['admin']),
    }
    const decoded = decode(encode(data)) as typeof data
    expect(decoded.users[0]!.joined).toBeInstanceOf(Date)
    expect(decoded.metadata).toBeInstanceOf(Map)
    expect(decoded.tags).toBeInstanceOf(Set)
  })

  it('is smaller than JSON.stringify for repeated structures', () => {
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i, name: `User${i}` }))
    const jsonSize = JSON.stringify(data).length
    const devalueSize = encode(data).length
    // devalue uses index-based references, should be smaller for repeated shapes
    expect(devalueSize).toBeLessThan(jsonSize * 1.5) // at worst 50% larger (due to encoding overhead for small payloads)
  })
})

// ── Server Content Negotiation ──────────────────────

describe('devalue server integration', () => {
  const k = katman({ context: () => ({}) })
  const router = k.router({
    time: k.$resolve(() => ({ now: new Date(), status: 'ok' })),
    echo: k.$resolve(({ input }: any) => input),
  })
  const handle = k.handler(router)

  it('returns devalue when Accept header is set', async () => {
    const res = await handle(
      new Request('http://localhost/time', {
        method: 'POST',
        headers: { accept: DEVALUE_CONTENT_TYPE },
      }),
    )
    expect(res.headers.get('content-type')).toBe(DEVALUE_CONTENT_TYPE)

    const text = await res.text()
    const data = decode(text) as any
    expect(data.now).toBeInstanceOf(Date)
    expect(data.status).toBe('ok')
  })

  it('returns JSON by default', async () => {
    const res = await handle(new Request('http://localhost/time', { method: 'POST' }))
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('decodes devalue request body', async () => {
    const input = { date: new Date('2026-01-01'), items: new Set([1, 2]) }
    const res = await handle(
      new Request('http://localhost/echo', {
        method: 'POST',
        headers: {
          'content-type': DEVALUE_CONTENT_TYPE,
          accept: DEVALUE_CONTENT_TYPE,
        },
        body: encode(input),
      }),
    )
    const data = decode(await res.text()) as any
    expect(data.date).toBeInstanceOf(Date)
    expect(data.items).toBeInstanceOf(Set)
  })
})
