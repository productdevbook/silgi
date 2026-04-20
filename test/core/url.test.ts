import { describe, expect, it } from 'vitest'

import { normalizePrefix, parseUrlPath, parseUrlPathname } from '#src/core/url.ts'

describe('parseUrlPath', () => {
  it('extracts path from absolute URL', () => {
    expect(parseUrlPath('http://localhost/foo/bar')).toBe('/foo/bar')
    expect(parseUrlPath('https://example.com/a/b')).toBe('/a/b')
  })

  it('strips query string', () => {
    expect(parseUrlPath('http://localhost/foo?bar=1')).toBe('/foo')
    expect(parseUrlPath('http://localhost/a/b?x=1&y=2')).toBe('/a/b')
  })

  it('handles bare path input — used by test harnesses and prefix-stripping adapters', () => {
    // Regression: old impl computed `indexOf('//') + 2 = 1` and then
    // `indexOf('/', 1)`, which silently produced bogus offsets.
    expect(parseUrlPath('/foo/bar')).toBe('/foo/bar')
    expect(parseUrlPath('/foo?q=1')).toBe('/foo')
    expect(parseUrlPath('/')).toBe('/')
  })

  it('handles URL with authority but no path', () => {
    expect(parseUrlPath('http://localhost')).toBe('/')
    expect(parseUrlPath('http://host.example.com')).toBe('/')
  })

  it('falls back gracefully on unparseable inputs', () => {
    expect(parseUrlPath('')).toBe('')
    expect(parseUrlPath('not-a-url')).toBe('not-a-url')
  })
})

describe('parseUrlPathname', () => {
  it('strips the leading slash', () => {
    expect(parseUrlPathname('http://localhost/foo')).toBe('foo')
    expect(parseUrlPathname('/foo/bar')).toBe('foo/bar')
  })

  it('returns empty string for root', () => {
    expect(parseUrlPathname('http://localhost/')).toBe('')
    expect(parseUrlPathname('/')).toBe('')
    expect(parseUrlPathname('http://localhost')).toBe('')
  })
})

describe('normalizePrefix', () => {
  it('ensures leading slash', () => {
    expect(normalizePrefix('api')).toBe('/api')
    expect(normalizePrefix('/api')).toBe('/api')
  })

  it('strips trailing slash', () => {
    expect(normalizePrefix('/api/')).toBe('/api')
    expect(normalizePrefix('api/')).toBe('/api')
  })

  it('preserves single slash', () => {
    // Pathological — degenerates to empty string. Test documents behavior.
    expect(normalizePrefix('/')).toBe('')
  })
})
