import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { compileStringify } from '#src/fast-stringify.ts'

describe('compileStringify', () => {
  it('falls back to JSON.stringify for null schema', () => {
    const fn = compileStringify(null)
    expect(fn).toBe(JSON.stringify)
  })

  describe('string', () => {
    const fn = compileStringify(z.string())

    it('stringifies simple string', () => {
      expect(fn('hello')).toBe('"hello"')
    })

    it('escapes double quotes', () => {
      expect(fn('say "hi"')).toBe('"say \\"hi\\""')
    })

    it('escapes backslash', () => {
      expect(fn('a\\b')).toBe('"a\\\\b"')
    })

    it('escapes newline', () => {
      expect(fn('a\nb')).toBe('"a\\nb"')
    })

    it('escapes tab', () => {
      expect(fn('a\tb')).toBe('"a\\tb"')
    })

    it('escapes control characters below 0x20', () => {
      const result = fn('\x00\x01\x1f')
      expect(JSON.parse(result)).toBe('\x00\x01\x1f')
    })

    it('handles empty string', () => {
      expect(fn('')).toBe('""')
    })
  })

  describe('number', () => {
    const fn = compileStringify(z.number())

    it('stringifies integer', () => {
      expect(fn(42)).toBe('42')
    })

    it('stringifies float', () => {
      expect(fn(3.14)).toBe('3.14')
    })

    it('stringifies negative', () => {
      expect(fn(-1)).toBe('-1')
    })
  })

  describe('boolean', () => {
    const fn = compileStringify(z.boolean())

    it('true', () => expect(fn(true)).toBe('true'))
    it('false', () => expect(fn(false)).toBe('false'))
  })

  describe('object', () => {
    const schema = z.object({ id: z.number(), name: z.string() })
    const fn = compileStringify(schema)

    it('stringifies simple object', () => {
      const result = fn({ id: 1, name: 'Alice' })
      expect(JSON.parse(result)).toEqual({ id: 1, name: 'Alice' })
    })

    it('handles special characters in values', () => {
      const result = fn({ id: 1, name: 'Alice "Bob" O\'Neal' })
      expect(JSON.parse(result)).toEqual({ id: 1, name: 'Alice "Bob" O\'Neal' })
    })

    it('handles empty object schema', () => {
      const emptyFn = compileStringify(z.object({}))
      expect(emptyFn({})).toBe('{}')
    })
  })

  describe('object with optional fields', () => {
    const schema = z.object({
      id: z.number(),
      name: z.string().optional(),
    })
    const fn = compileStringify(schema)

    it('includes present optional field', () => {
      const result = fn({ id: 1, name: 'Alice' })
      expect(JSON.parse(result)).toEqual({ id: 1, name: 'Alice' })
    })

    it('skips undefined optional field', () => {
      const result = fn({ id: 1 })
      expect(JSON.parse(result)).toEqual({ id: 1 })
    })
  })

  describe('nullable', () => {
    const fn = compileStringify(z.string().nullable())

    it('stringifies null as "null"', () => {
      expect(fn(null)).toBe('null')
    })

    it('stringifies string value', () => {
      expect(fn('hello')).toBe('"hello"')
    })
  })

  describe('object with 9+ properties falls back to JSON.stringify or general case', () => {
    const shape: Record<string, any> = {}
    for (let i = 0; i < 10; i++) shape[`f${i}`] = z.number()
    const schema = z.object(shape)
    const fn = compileStringify(schema)

    it('produces valid JSON', () => {
      const obj: Record<string, number> = {}
      for (let i = 0; i < 10; i++) obj[`f${i}`] = i
      const result = fn(obj)
      expect(JSON.parse(result)).toEqual(obj)
    })
  })
})
