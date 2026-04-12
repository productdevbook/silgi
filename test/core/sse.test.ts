import { describe, expect, it } from 'vitest'

import { encodeEventMessage, EventDecoder, withEventMeta, getEventMeta } from '#src/core/sse.ts'

describe('encodeEventMessage', () => {
  it('encodes a simple data message', () => {
    const result = encodeEventMessage({ data: 'hello' })
    expect(result).toBe('data: hello\n\n')
  })

  it('encodes event + data', () => {
    const result = encodeEventMessage({ event: 'message', data: '{"id":1}' })
    expect(result).toBe('event: message\ndata: {"id":1}\n\n')
  })

  it('encodes multiline data', () => {
    const result = encodeEventMessage({ data: 'line1\nline2\nline3' })
    expect(result).toBe('data: line1\ndata: line2\ndata: line3\n\n')
  })

  it('encodes id and retry fields', () => {
    const result = encodeEventMessage({ event: 'message', data: 'x', id: '42', retry: 5000 })
    expect(result).toContain('id: 42\n')
    expect(result).toContain('retry: 5000\n')
  })

  it('encodes comment', () => {
    const result = encodeEventMessage({ comment: 'keepalive' })
    expect(result).toBe(': keepalive\n\n')
  })

  it('encodes multiline comment', () => {
    const result = encodeEventMessage({ comment: 'line1\nline2' })
    expect(result).toBe(': line1\n: line2\n\n')
  })
})

describe('EventDecoder', () => {
  it('decodes a complete event block', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    decoder.feed('event: message\ndata: hello\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ event: 'message', data: 'hello' })
  })

  it('handles split chunks', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    // Feed partial data
    decoder.feed('event: messa')
    expect(events).toHaveLength(0)

    // Complete the block
    decoder.feed('ge\ndata: hello\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({ event: 'message', data: 'hello' })
  })

  it('handles multiple events in one chunk', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    decoder.feed('data: one\n\ndata: two\n\ndata: three\n\n')
    expect(events).toHaveLength(3)
    expect(events[0]!.data).toBe('one')
    expect(events[1]!.data).toBe('two')
    expect(events[2]!.data).toBe('three')
  })

  it('concatenates multiline data fields', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    decoder.feed('data: line1\ndata: line2\n\n')
    expect(events[0]!.data).toBe('line1\nline2')
  })

  it('flush emits incomplete trailing event', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    decoder.feed('data: trailing')
    expect(events).toHaveLength(0)

    decoder.flush()
    expect(events).toHaveLength(1)
    expect(events[0]!.data).toBe('trailing')
  })

  it('parses comment lines', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    decoder.feed(': this is a comment\n\n')
    expect(events).toHaveLength(1)
    expect(events[0]!.comment).toBe('this is a comment')
  })

  it('parses id and retry', () => {
    const events: any[] = []
    const decoder = new EventDecoder((msg) => events.push(msg))

    decoder.feed('id: 42\nretry: 3000\ndata: test\n\n')
    expect(events[0]).toEqual({ id: '42', retry: 3000, data: 'test' })
  })
})

describe('withEventMeta / getEventMeta', () => {
  it('attaches and reads metadata from an object', () => {
    const value = { name: 'test' }
    const withMeta = withEventMeta(value, { id: '123', retry: 5000 })

    // Normal property access works
    expect(withMeta.name).toBe('test')

    // Metadata is readable
    const meta = getEventMeta(withMeta)
    expect(meta).toEqual({ id: '123', retry: 5000 })
  })

  it('only works with objects (primitives pass through unchanged)', () => {
    // withEventMeta on primitives is a no-op (no side-channel, no boxing)
    const num = withEventMeta(42, { id: '1' })
    expect(num).toBe(42)
    expect(getEventMeta(42)).toBeUndefined()

    // Objects work correctly
    const obj = { value: 42 }
    withEventMeta(obj, { id: '1' })
    expect(getEventMeta(obj)).toEqual({ id: '1' })

    // null is returned as-is
    expect(withEventMeta(null, { id: '1' })).toBe(null)
  })

  it('returns undefined meta for objects without meta', () => {
    expect(getEventMeta({ a: 1 })).toBeUndefined()
  })

  it('returns undefined meta for non-objects without prior withEventMeta', () => {
    expect(getEventMeta(99)).toBeUndefined()
    expect(getEventMeta(null)).toBeUndefined()
  })
})
