import { describe, it, expect } from 'vitest'

import { coerceValue, coerceObject } from '#src/plugins/coerce.ts'

describe('Smart coercion', () => {
  it('coerces strings to proper types', () => {
    expect(coerceValue('42')).toBe(42)
    expect(coerceValue('3.14')).toBe(3.14)
    expect(coerceValue('true')).toBe(true)
    expect(coerceValue('false')).toBe(false)
    expect(coerceValue('null')).toBeNull()
    expect(coerceValue('undefined')).toBeUndefined()
    expect(coerceValue('')).toBeUndefined()
    expect(coerceValue('hello')).toBe('hello')
  })

  it('coerceObject transforms object values', () => {
    const obj: Record<string, unknown> = { id: '42', active: 'true', name: 'Alice' }
    coerceObject(obj)
    expect(obj).toEqual({ id: 42, active: true, name: 'Alice' })
  })
})
