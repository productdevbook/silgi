import { describe, it, expect } from 'vitest'

import { sign, unsign } from '#src/plugins/signing.ts'

describe('Signing', () => {
  it('sign and unsign round-trip', async () => {
    const signed = await sign('hello', 'secret')
    expect(signed).toContain('hello.')
    const value = await unsign(signed, 'secret')
    expect(value).toBe('hello')
  })

  it('unsign returns null for tampered value', async () => {
    const signed = await sign('hello', 'secret')
    const tampered = signed.replace('hello', 'hacked')
    expect(await unsign(tampered, 'secret')).toBeNull()
  })

  it('unsign returns null for wrong secret', async () => {
    const signed = await sign('hello', 'secret1')
    expect(await unsign(signed, 'secret2')).toBeNull()
  })
})
