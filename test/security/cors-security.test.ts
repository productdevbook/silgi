import { describe, expect, it } from 'vitest'

import { cors, corsHeaders } from '#src/plugins/cors.ts'

describe('CORS — security', () => {
  it('should reject or warn when credentials: true with wildcard origin', () => {
    // This combination is dangerous — should throw or return safe headers
    expect(() => cors({ credentials: true })).toThrow()
  })

  it('credentials: true with explicit origin is allowed', () => {
    const result = cors({ origin: 'https://app.example.com', credentials: true })
    expect(result.headers['access-control-allow-credentials']).toBe('true')
    expect(result.headers['access-control-allow-origin']).toBe('https://app.example.com')
  })

  it('does not reflect disallowed origin from array', () => {
    const headers = corsHeaders({ origin: ['https://a.com', 'https://b.com'] }, 'https://evil.com')
    // Must not return any valid origin for disallowed requesters
    expect(headers['access-control-allow-origin']).toBe('')
  })
})
