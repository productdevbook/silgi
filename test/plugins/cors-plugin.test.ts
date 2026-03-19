import { describe, expect, it } from 'vitest'

import { cors, corsHeaders } from '#src/plugins/cors.ts'

describe('cors()', () => {
  it('returns cors config with pre-computed headers', () => {
    const result = cors({ origin: 'https://app.example.com', credentials: true })
    expect(result.headers).toBeDefined()
    expect(result.headers['access-control-allow-origin']).toBe('https://app.example.com')
    expect(result.headers['access-control-allow-credentials']).toBe('true')
    expect(result.options).toBeDefined()
  })
})

describe('corsHeaders()', () => {
  it('returns wildcard origin by default', () => {
    const headers = corsHeaders()
    expect(headers['access-control-allow-origin']).toBe('*')
  })

  it('returns string origin', () => {
    const headers = corsHeaders({ origin: 'https://app.example.com' })
    expect(headers['access-control-allow-origin']).toBe('https://app.example.com')
  })

  it('reflects matching origin from array', () => {
    const headers = corsHeaders({ origin: ['https://a.com', 'https://b.com'] }, 'https://b.com')
    expect(headers['access-control-allow-origin']).toBe('https://b.com')
    expect(headers['vary']).toBe('Origin')
  })

  it('does not reflect non-matching origin from array', () => {
    const headers = corsHeaders({ origin: ['https://a.com', 'https://b.com'] }, 'https://evil.com')
    // Should NOT return a valid allowed origin for disallowed requesters
    expect(headers['access-control-allow-origin']).not.toBe('https://evil.com')
  })

  it('evaluates function origin', () => {
    const headers = corsHeaders({ origin: (o) => o.endsWith('.example.com') }, 'https://app.example.com')
    expect(headers['access-control-allow-origin']).toBe('https://app.example.com')
  })

  it('rejects function origin when not matching', () => {
    const headers = corsHeaders({ origin: (o) => o.endsWith('.example.com') }, 'https://evil.com')
    expect(headers['access-control-allow-origin']).toBe('')
  })

  it('includes credentials header', () => {
    const headers = corsHeaders({ credentials: true })
    expect(headers['access-control-allow-credentials']).toBe('true')
  })

  it('includes max-age', () => {
    const headers = corsHeaders({ maxAge: 3600 })
    expect(headers['access-control-max-age']).toBe('3600')
  })

  it('includes exposed headers', () => {
    const headers = corsHeaders({ exposedHeaders: ['X-Total', 'X-Page'] })
    expect(headers['access-control-expose-headers']).toBe('X-Total, X-Page')
  })

  it('includes default methods', () => {
    const headers = corsHeaders()
    expect(headers['access-control-allow-methods']).toContain('GET')
    expect(headers['access-control-allow-methods']).toContain('POST')
  })
})
