import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { coerceGuard, coerceObject, coerceValue } from '#src/plugins/coerce.ts'
import { silgi } from '#src/silgi.ts'

describe('coerceValue', () => {
  it('coerces numeric strings to numbers', () => {
    expect(coerceValue('42')).toBe(42)
    expect(coerceValue('-7')).toBe(-7)
    expect(coerceValue('3.14')).toBe(3.14)
  })

  it('coerces boolean strings', () => {
    expect(coerceValue('true')).toBe(true)
    expect(coerceValue('false')).toBe(false)
  })

  it('coerces null/undefined sentinels', () => {
    expect(coerceValue('null')).toBe(null)
    expect(coerceValue('undefined')).toBe(undefined)
    expect(coerceValue('')).toBe(undefined)
  })

  it('leaves non-string values alone', () => {
    expect(coerceValue(42)).toBe(42)
    expect(coerceValue(null)).toBe(null)
    expect(coerceValue(undefined)).toBe(undefined)
  })

  it('does not coerce strings that only partially parse as numbers', () => {
    // Number('42abc') → NaN; but Number('42 ') → 42, filter via round-trip.
    expect(coerceValue('42abc')).toBe('42abc')
    expect(coerceValue('42 ')).toBe('42 ')
  })
})

describe('coerceObject', () => {
  it('coerces one level deep', () => {
    const obj = { id: '42', active: 'true', nested: { score: '3.14' } }
    coerceObject(obj)
    expect(obj).toEqual({ id: 42, active: true, nested: { score: 3.14 } })
  })

  it('coerces array elements', () => {
    const obj = { ids: ['1', '2', '3'] }
    coerceObject(obj)
    expect(obj.ids).toEqual([1, 2, 3])
  })
})

describe('coerceGuard integration', () => {
  it('works when no input schema is used — resolver sees coerced values', async () => {
    const s = silgi({ context: () => ({}) })
    const r = s.router({
      peek: s.$use(coerceGuard).$resolve(({ input }) => input),
    })

    const handler = s.handler(r)
    const res = await handler(
      new Request('http://localhost/peek', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '42', flag: 'true' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 42, flag: true })
  })

  it('documented caveat: z.number() rejects "42" because validate runs before the wrap', async () => {
    const s = silgi({ context: () => ({}) })
    const r = s.router({
      strict: s
        .$use(coerceGuard)
        .$input(z.object({ id: z.number() }))
        .$resolve(({ input }) => input),
    })

    const handler = s.handler(r)
    const res = await handler(
      new Request('http://localhost/strict', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '42' }),
      }),
    )
    // Validation fires first; string fails z.number() — coerceGuard never runs.
    // This test pins that documented behavior so users see a signal if a future
    // reorder accidentally "fixes" it and breaks the other documented paths.
    expect(res.status).toBe(400)
  })

  it('recommended pattern: pair with z.coerce.number() — validate handles coercion', async () => {
    const s = silgi({ context: () => ({}) })
    const r = s.router({
      lenient: s.$input(z.object({ id: z.coerce.number() })).$resolve(({ input }) => input),
    })

    const handler = s.handler(r)
    const res = await handler(
      new Request('http://localhost/lenient', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: '42' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 42 })
  })
})
