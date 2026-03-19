import { Packr } from 'msgpackr'
import { describe, expect, it } from 'vitest'

import { decode, encode } from '#src/codec/msgpack.ts'

describe('msgpack — security', () => {
  it('should not deserialize Error objects from untrusted input', () => {
    // Simulate attacker using moreTypes encoder to send Error
    const attackerCodec = new Packr({ useRecords: false, moreTypes: true })
    const malicious = attackerCodec.pack(new Error('injected error'))
    const decoded = decode(malicious)

    // Decoded untrusted input must not produce Error instances
    expect(decoded).not.toBeInstanceOf(Error)
  })

  it('should not deserialize RegExp from untrusted input', () => {
    const attackerCodec = new Packr({ useRecords: false, moreTypes: true })
    const malicious = attackerCodec.pack(/a{10000,}b{10000,}c{10000,}/)
    const decoded = decode(malicious)

    // Decoded untrusted input must not produce RegExp instances (ReDoS risk)
    expect(decoded).not.toBeInstanceOf(RegExp)
  })

  it('encode/decode roundtrip works for plain data', () => {
    const data = { id: 1, name: 'Alice', tags: ['admin'] }
    const buf = new Uint8Array(encode(data) as ArrayBuffer)
    const decoded = decode(buf)
    expect(decoded).toEqual(data)
  })
})
