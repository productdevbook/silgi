import { describe, expect, it } from 'vitest'

import { setCookie } from '#src/plugins/cookies.ts'

describe('setCookie — security', () => {
  it('SameSite=None MUST include Secure flag', () => {
    const cookie = setCookie('session', 'abc', { sameSite: 'none' })
    expect(cookie).toContain('SameSite=None')
    // SameSite=None without Secure is invalid per RFC 6265bis
    expect(cookie).toContain('Secure')
  })

  it('default SameSite is lax', () => {
    const cookie = setCookie('name', 'val')
    expect(cookie).toContain('SameSite=Lax')
  })

  it('HttpOnly is enabled by default', () => {
    const cookie = setCookie('name', 'val')
    expect(cookie).toContain('HttpOnly')
  })

  it('encodes cookie value to prevent injection', () => {
    const cookie = setCookie('name', 'a; Path=/evil; HttpOnly=false')
    // Value should be encoded, not injected as raw attributes
    expect(cookie).not.toContain('; Path=/evil')
    expect(cookie).toContain('a%3B%20Path%3D%2Fevil')
  })
})
