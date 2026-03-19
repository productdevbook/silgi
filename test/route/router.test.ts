/**
 * Router tests — comprehensive test suite ported from rou3.
 */
import { describe, it, expect } from 'vitest'

import { createRouter, addRoute, findRoute, removeRoute } from '#src/route/index.ts'

function setup(paths: string[], method = 'GET') {
  const router = createRouter<{ path: string }>()
  for (const path of paths) addRoute(router, method, path, { path })
  return router
}

// ═══════════════════════════════════════════════════
//  Static Routes
// ═══════════════════════════════════════════════════

describe('static routes', () => {
  it('exact matches', () => {
    const r = setup(['/', '/route', '/another-router', '/this/is/yet/another/route'])
    expect(findRoute(r, 'GET', '/')).toMatchObject({ data: { path: '/' } })
    expect(findRoute(r, 'GET', '/route')).toMatchObject({ data: { path: '/route' } })
    expect(findRoute(r, 'GET', '/another-router')).toMatchObject({ data: { path: '/another-router' } })
    expect(findRoute(r, 'GET', '/this/is/yet/another/route')).toMatchObject({ data: { path: '/this/is/yet/another/route' } })
    expect(findRoute(r, 'GET', '/missing')).toBeUndefined()
  })

  it('trailing slash normalization', () => {
    const r = setup(['/route/without/trailing/slash', '/route/with/trailing/slash/'])
    expect(findRoute(r, 'GET', '/route/without/trailing/slash/')).toMatchObject({ data: { path: '/route/without/trailing/slash' } })
    expect(findRoute(r, 'GET', '/route/with/trailing/slash')).toMatchObject({ data: { path: '/route/with/trailing/slash/' } })
  })
})

// ═══════════════════════════════════════════════════
//  Parametric Routes
// ═══════════════════════════════════════════════════

describe('parametric routes', () => {
  it('single param', () => {
    const r = setup(['/carbon/:element'])
    expect(findRoute(r, 'GET', '/carbon/test1')).toMatchObject({ data: { path: '/carbon/:element' }, params: { element: 'test1' } })
    expect(findRoute(r, 'GET', '/carbon')).toBeUndefined()
  })

  it('multiple params across segments', () => {
    const r = setup(['/carbon/:element/test/:testing'])
    expect(findRoute(r, 'GET', '/carbon/test2/test/test23')).toMatchObject({
      data: { path: '/carbon/:element/test/:testing' },
      params: { element: 'test2', testing: 'test23' },
    })
  })

  it('params between static segments', () => {
    const r = setup(['/this/:route/has/:cool/stuff'])
    expect(findRoute(r, 'GET', '/this/test/has/more/stuff')).toMatchObject({
      data: { path: '/this/:route/has/:cool/stuff' },
      params: { route: 'test', cool: 'more' },
    })
  })

  it('nested param depth', () => {
    const r = setup(['/', '/:a', '/:a/:b', '/:a/:x/:b', '/:a/:y/:x/:b'])
    expect(findRoute(r, 'GET', '/')).toMatchObject({ data: { path: '/' } })
    expect(findRoute(r, 'GET', '/a')).toMatchObject({ data: { path: '/:a' }, params: { a: 'a' } })
    expect(findRoute(r, 'GET', '/a/b')).toMatchObject({ data: { path: '/:a/:b' }, params: { a: 'a', b: 'b' } })
    expect(findRoute(r, 'GET', '/a/x/b')).toMatchObject({ data: { path: '/:a/:x/:b' }, params: { a: 'a', x: 'x', b: 'b' } })
    expect(findRoute(r, 'GET', '/a/y/x/b')).toMatchObject({ data: { path: '/:a/:y/:x/:b' }, params: { a: 'a', y: 'y', x: 'x', b: 'b' } })
  })

  it('complex nested params (GitHub-like)', () => {
    const r = setup(['/', '/:packageAndRefOrSha', '/:owner/:repo/', '/:owner/:repo/:packageAndRefOrSha', '/:owner/:repo/:npmOrg/:packageAndRefOrSha'])
    expect(findRoute(r, 'GET', '/tinylibs/tinybench/tiny@232')).toMatchObject({
      data: { path: '/:owner/:repo/:packageAndRefOrSha' },
      params: { owner: 'tinylibs', repo: 'tinybench', packageAndRefOrSha: 'tiny@232' },
    })
    expect(findRoute(r, 'GET', '/tinylibs/tinybench/@tinylibs/tiny@232')).toMatchObject({
      data: { path: '/:owner/:repo/:npmOrg/:packageAndRefOrSha' },
      params: { owner: 'tinylibs', repo: 'tinybench', npmOrg: '@tinylibs', packageAndRefOrSha: 'tiny@232' },
    })
  })

  it('hyphenated param names', () => {
    const r = setup(['/users/:user-id', '/users/:user-id/posts/:post-id'])
    expect(findRoute(r, 'GET', '/users/123')).toMatchObject({ data: { path: '/users/:user-id' }, params: { 'user-id': '123' } })
    expect(findRoute(r, 'GET', '/users/abc/posts/456')).toMatchObject({
      data: { path: '/users/:user-id/posts/:post-id' },
      params: { 'user-id': 'abc', 'post-id': '456' },
    })
  })
})

// ═══════════════════════════════════════════════════
//  Wildcard Routes
// ═══════════════════════════════════════════════════

describe('wildcard routes', () => {
  it('catch-all **', () => {
    const r = setup(['/wildcard/**'])
    expect(findRoute(r, 'GET', '/wildcard/foo')).toMatchObject({ data: { path: '/wildcard/**' }, params: { _: 'foo' } })
    expect(findRoute(r, 'GET', '/wildcard/foo/bar')).toMatchObject({ data: { path: '/wildcard/**' }, params: { _: 'foo/bar' } })
  })

  it('named catch-all **:name', () => {
    const r = setup(['/polymer/**:id', '/polymer/another/route'])
    expect(findRoute(r, 'GET', '/polymer/another/route')).toMatchObject({ data: { path: '/polymer/another/route' } })
    expect(findRoute(r, 'GET', '/polymer/anon')).toMatchObject({ data: { path: '/polymer/**:id' }, params: { id: 'anon' } })
    expect(findRoute(r, 'GET', '/polymer/foo/bar/baz')).toMatchObject({ data: { path: '/polymer/**:id' }, params: { id: 'foo/bar/baz' } })
  })

  it('single wildcard *', () => {
    const r = setup(['/blog/*'])
    expect(findRoute(r, 'GET', '/blog/123')).toMatchObject({ data: { path: '/blog/*' } })
  })

  it('root catch-all', () => {
    const r = setup(['/**'])
    expect(findRoute(r, 'GET', '/anything')).toMatchObject({ data: { path: '/**' }, params: { _: 'anything' } })
    expect(findRoute(r, 'GET', '/any/deep/path')).toMatchObject({ data: { path: '/**' }, params: { _: 'any/deep/path' } })
  })

  it('wildcard with static sibling — static wins', () => {
    const r = setup(['/polymer/**', '/polymer/another/route'])
    expect(findRoute(r, 'GET', '/polymer/another/route')).toMatchObject({ data: { path: '/polymer/another/route' } })
    expect(findRoute(r, 'GET', '/polymer/foo/bar')).toMatchObject({ data: { path: '/polymer/**' }, params: { _: 'foo/bar' } })
  })

  it('fallback to wildcard from static', () => {
    const r = setup(['/wildcard/**', '/test/**', '/test', '/dynamic/*'])
    expect(findRoute(r, 'GET', '/wildcard')).toMatchObject({ data: { path: '/wildcard/**' } })
    expect(findRoute(r, 'GET', '/wildcard/abc')).toMatchObject({ data: { path: '/wildcard/**' }, params: { _: 'abc' } })
    expect(findRoute(r, 'GET', '/wildcard/abc/def')).toMatchObject({ data: { path: '/wildcard/**' }, params: { _: 'abc/def' } })
    expect(findRoute(r, 'GET', '/test')).toMatchObject({ data: { path: '/test' } })
    expect(findRoute(r, 'GET', '/test/abc')).toMatchObject({ data: { path: '/test/**' }, params: { _: 'abc' } })
  })

  it('param with wildcard: /route/:p1/something/**:rest', () => {
    const r = setup(['/route/:p1/something/**:rest'])
    expect(findRoute(r, 'GET', '/route/param1/something/c/d')).toMatchObject({
      data: { path: '/route/:p1/something/**:rest' },
      params: { p1: 'param1', rest: 'c/d' },
    })
  })
})

// ═══════════════════════════════════════════════════
//  Regex Constraints
// ═══════════════════════════════════════════════════

describe('regex constraints', () => {
  it('numeric param :id(\\d+)', () => {
    const r = setup(['/users/:id(\\d+)'])
    expect(findRoute(r, 'GET', '/users/123')).toMatchObject({ data: { path: '/users/:id(\\d+)' }, params: { id: '123' } })
    expect(findRoute(r, 'GET', '/users/abc')).toBeUndefined()
  })

  it('enum param :ext(png|jpg|gif)', () => {
    const r = setup(['/files/:ext(png|jpg|gif)'])
    expect(findRoute(r, 'GET', '/files/png')).toMatchObject({ params: { ext: 'png' } })
    expect(findRoute(r, 'GET', '/files/jpg')).toMatchObject({ params: { ext: 'jpg' } })
    expect(findRoute(r, 'GET', '/files/pdf')).toBeUndefined()
  })

  it('regex + unconstrained coexist', () => {
    const r = setup(['/users/:id(\\d+)', '/users/:slug'])
    expect(findRoute(r, 'GET', '/users/123')).toMatchObject({ data: { path: '/users/:id(\\d+)' }, params: { id: '123' } })
    expect(findRoute(r, 'GET', '/users/abc')).toMatchObject({ data: { path: '/users/:slug' }, params: { slug: 'abc' } })
  })

  it('versioned API :version(v\\d+)', () => {
    const r = setup(['/api/:version(v\\d+)/:resource'])
    expect(findRoute(r, 'GET', '/api/v2/users')).toMatchObject({ params: { version: 'v2', resource: 'users' } })
    expect(findRoute(r, 'GET', '/api/latest/users')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════
//  Optional & Modifier Params
// ═══════════════════════════════════════════════════

describe('optional params', () => {
  it(':name? at end', () => {
    const r = setup(['/users/:id?'])
    expect(findRoute(r, 'GET', '/users/123')).toMatchObject({ data: { path: '/users/:id?' }, params: { id: '123' } })
    expect(findRoute(r, 'GET', '/users')).toMatchObject({ data: { path: '/users/:id?' } })
  })

  it(':name(\\d+)? — optional with regex', () => {
    const r = setup(['/users/:id(\\d+)?'])
    expect(findRoute(r, 'GET', '/users/123')).toMatchObject({ params: { id: '123' } })
    expect(findRoute(r, 'GET', '/users')).toMatchObject({ data: { path: '/users/:id(\\d+)?' } })
    expect(findRoute(r, 'GET', '/users/abc')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════
//  Method Dispatch
// ═══════════════════════════════════════════════════

describe('method dispatch', () => {
  it('different methods on same path', () => {
    const r = createRouter<{ method: string }>()
    addRoute(r, 'GET', '/users', { method: 'GET' })
    addRoute(r, 'POST', '/users', { method: 'POST' })
    addRoute(r, 'DELETE', '/users/:id', { method: 'DELETE' })

    expect(findRoute(r, 'GET', '/users')).toMatchObject({ data: { method: 'GET' } })
    expect(findRoute(r, 'POST', '/users')).toMatchObject({ data: { method: 'POST' } })
    expect(findRoute(r, 'DELETE', '/users/123')).toMatchObject({ data: { method: 'DELETE' }, params: { id: '123' } })
    expect(findRoute(r, 'PATCH', '/users')).toBeUndefined()
  })

  it('empty method matches any', () => {
    const r = createRouter<{ path: string }>()
    addRoute(r, '', '/fallback', { path: '/fallback' })
    expect(findRoute(r, 'GET', '/fallback')).toMatchObject({ data: { path: '/fallback' } })
    expect(findRoute(r, 'POST', '/fallback')).toMatchObject({ data: { path: '/fallback' } })
  })
})

// ═══════════════════════════════════════════════════
//  Remove Routes
// ═══════════════════════════════════════════════════

describe('remove routes', () => {
  it('removes static route', () => {
    const r = setup(['/hello', '/cool'])
    expect(findRoute(r, 'GET', '/hello')).toBeDefined()
    removeRoute(r, 'GET', '/hello')
    expect(findRoute(r, 'GET', '/hello')).toBeUndefined()
    expect(findRoute(r, 'GET', '/cool')).toBeDefined()
  })

  it('removes param route', () => {
    const r = setup(['/placeholder/:choo', '/placeholder/:choo/:choo2'])
    expect(findRoute(r, 'GET', '/placeholder/route')).toMatchObject({ params: { choo: 'route' } })
    expect(findRoute(r, 'GET', '/placeholder/route/route2')).toMatchObject({ params: { choo: 'route', choo2: 'route2' } })
  })

  it('removes wildcard route — falls back to parent', () => {
    const r = setup(['/ui/**', '/ui/components/**'])
    expect(findRoute(r, 'GET', '/ui/components/snackbars')).toMatchObject({ data: { path: '/ui/components/**' } })
    removeRoute(r, 'GET', '/ui/components/**')
    expect(findRoute(r, 'GET', '/ui/components/snackbars')).toMatchObject({ data: { path: '/ui/**' } })
  })

  it('removes named wildcard route', () => {
    const r = setup(['/user/**:id'])
    removeRoute(r, 'GET', '/user/**:id')
    expect(findRoute(r, 'GET', '/user/123')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════
//  Complex Mixed Scenarios (from rou3 find.test.ts)
// ═══════════════════════════════════════════════════

describe('mixed scenarios', () => {
  it('static + param + wildcard coexist', () => {
    const r = setup([
      '/test',
      '/test/:id',
      '/test/foo',
      '/test/foo/*',
      '/test/foo/**',
      '/test/foo/bar/qux',
      '/test/foo/baz',
      '/test/fooo',
      '/another/path',
      '/wildcard/**',
      '/**',
    ])

    // Static
    expect(findRoute(r, 'GET', '/test')).toMatchObject({ data: { path: '/test' } })
    expect(findRoute(r, 'GET', '/test/foo')).toMatchObject({ data: { path: '/test/foo' } })
    expect(findRoute(r, 'GET', '/test/fooo')).toMatchObject({ data: { path: '/test/fooo' } })
    expect(findRoute(r, 'GET', '/another/path')).toMatchObject({ data: { path: '/another/path' } })

    // Param
    expect(findRoute(r, 'GET', '/test/123')).toMatchObject({ data: { path: '/test/:id' }, params: { id: '123' } })
    expect(findRoute(r, 'GET', '/test/foo/123')).toMatchObject({ data: { path: '/test/foo/*' } })

    // Wildcard
    expect(findRoute(r, 'GET', '/test/foo/123/456')).toMatchObject({ data: { path: '/test/foo/**' }, params: { _: '123/456' } })
    expect(findRoute(r, 'GET', '/wildcard/foo')).toMatchObject({ data: { path: '/wildcard/**' }, params: { _: 'foo' } })
    expect(findRoute(r, 'GET', '/wildcard/foo/bar')).toMatchObject({ data: { path: '/wildcard/**' }, params: { _: 'foo/bar' } })

    // Root catch-all
    expect(findRoute(r, 'GET', '/anything')).toMatchObject({ data: { path: '/**' }, params: { _: 'anything' } })
    expect(findRoute(r, 'GET', '/any/deep/path')).toMatchObject({ data: { path: '/**' }, params: { _: 'any/deep/path' } })
  })
})
