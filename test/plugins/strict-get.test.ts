import { describe, it, expect } from 'vitest'

import { strictGetGuard } from '#src/plugins/strict-get.ts'

describe('strictGetGuard', () => {
  it('passes for GET', () => {
    expect(() => strictGetGuard.fn({ method: 'GET' })).not.toThrow()
  })

  it('passes for HEAD', () => {
    expect(() => strictGetGuard.fn({ method: 'HEAD' })).not.toThrow()
  })

  it('throws for POST', () => {
    expect(() => strictGetGuard.fn({ method: 'POST' })).toThrow()
  })

  it('passes when no method info', () => {
    expect(() => strictGetGuard.fn({})).not.toThrow()
  })
})
