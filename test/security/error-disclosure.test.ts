import { describe, expect, it } from 'vitest'

import { toKatmanError } from '#src/core/error.ts'
import { katman } from '#src/katman.ts'

describe('toKatmanError — information disclosure', () => {
  it('should NOT leak internal error messages to clients', () => {
    const internalError = new Error('connect ECONNREFUSED 10.0.0.5:5432')
    const katmanErr = toKatmanError(internalError)
    const json = katmanErr.toJSON()

    // The serialized error sent to clients must NOT contain internal details
    expect(json.message).not.toContain('ECONNREFUSED')
    expect(json.message).not.toContain('10.0.0.5')
    expect(json.message).toBe('Internal server error')
  })

  it('should NOT leak file paths', () => {
    const fsError = new Error("ENOENT: no such file or directory, open '/etc/app/config.secret'")
    const katmanErr = toKatmanError(fsError)
    const json = katmanErr.toJSON()

    expect(json.message).not.toContain('ENOENT')
    expect(json.message).not.toContain('/etc/app')
  })

  it('preserves cause for server-side logging', () => {
    const original = new Error('DB connection failed')
    const katmanErr = toKatmanError(original)

    // Internal cause should be accessible server-side
    expect(katmanErr.cause).toBe(original)
  })

  it('handler should not expose internal errors in response body', async () => {
    const k = katman({ context: () => ({}) })
    const router = k.router({
      broken: k.query(() => {
        throw new Error('SELECT * FROM secret_table WHERE password = ...')
      }),
    })
    const handle = k.handler(router)
    const res = await handle(new Request('http://localhost/broken'))
    const body = await res.json()

    expect(body.message).not.toContain('SELECT')
    expect(body.message).not.toContain('secret_table')
  })
})
