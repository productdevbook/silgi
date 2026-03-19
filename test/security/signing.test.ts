import { describe, expect, it } from 'vitest'

import { sign, unsign } from '#src/plugins/signing.ts'

describe('signing — security', () => {
  const SECRET = 'test-secret-key-123'

  it('rejects odd-length hex signature gracefully', async () => {
    const signed = await sign('hello', SECRET)
    // Truncate last hex char to make odd-length
    const corrupted = signed.slice(0, -1)
    const result = await unsign(corrupted, SECRET)
    expect(result).toBeNull()
  })

  it('rejects empty signature', async () => {
    const result = await unsign('hello.', SECRET)
    expect(result).toBeNull()
  })

  it('rejects non-hex characters in signature', async () => {
    const result = await unsign('hello.zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz', SECRET)
    expect(result).toBeNull()
  })

  it('rejects missing dot separator', async () => {
    const result = await unsign('no-dot-here', SECRET)
    expect(result).toBeNull()
  })

  it('valid sign/unsign roundtrip works', async () => {
    const signed = await sign('user:123', SECRET)
    const result = await unsign(signed, SECRET)
    expect(result).toBe('user:123')
  })

  it('rejects tampered value', async () => {
    const signed = await sign('user:123', SECRET)
    const tampered = signed.replace('user:123', 'user:999')
    const result = await unsign(tampered, SECRET)
    expect(result).toBeNull()
  })
})
