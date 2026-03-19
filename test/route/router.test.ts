/**
 * Router tests — ported from rou3 test suite.
 */
import { describe, it, expect } from 'vitest'

import { createRouter, addRoute, findRoute, removeRoute } from '#src/route/index.ts'

function setupRouter<T = { path: string }>(paths: string[], method = 'GET') {
  const router = createRouter<T>()
  for (const path of paths) {
    addRoute(router, method, path, { path } as T)
  }
  return router
}

describe('static routes', () => {
  it('matches exact static paths', () => {
    const router = setupRouter(['/', '/route', '/another-router', '/this/is/yet/another/route'])

    expect(findRoute(router, 'GET', '/')).toMatchObject({ data: { path: '/' } })
    expect(findRoute(router, 'GET', '/route')).toMatchObject({ data: { path: '/route' } })
    expect(findRoute(router, 'GET', '/another-router')).toMatchObject({ data: { path: '/another-router' } })
    expect(findRoute(router, 'GET', '/this/is/yet/another/route')).toMatchObject({
      data: { path: '/this/is/yet/another/route' },
    })
    expect(findRoute(router, 'GET', '/missing')).toBeUndefined()
  })

  it('trailing slash normalization', () => {
    const router = setupRouter(['/route/without/trailing/slash', '/route/with/trailing/slash/'])
    expect(findRoute(router, 'GET', '/route/without/trailing/slash/')).toMatchObject({
      data: { path: '/route/without/trailing/slash' },
    })
    expect(findRoute(router, 'GET', '/route/with/trailing/slash')).toMatchObject({
      data: { path: '/route/with/trailing/slash/' },
    })
  })
})

describe('parametric routes', () => {
  it('single param', () => {
    const router = setupRouter(['/carbon/:element'])
    expect(findRoute(router, 'GET', '/carbon/test1')).toMatchObject({
      data: { path: '/carbon/:element' },
      params: { element: 'test1' },
    })
    expect(findRoute(router, 'GET', '/carbon')).toBeUndefined()
  })

  it('multiple params', () => {
    const router = setupRouter(['/carbon/:element/test/:testing'])
    expect(findRoute(router, 'GET', '/carbon/test2/test/test23')).toMatchObject({
      data: { path: '/carbon/:element/test/:testing' },
      params: { element: 'test2', testing: 'test23' },
    })
  })

  it('params in different positions', () => {
    const router = setupRouter(['/this/:route/has/:cool/stuff'])
    expect(findRoute(router, 'GET', '/this/test/has/more/stuff')).toMatchObject({
      data: { path: '/this/:route/has/:cool/stuff' },
      params: { route: 'test', cool: 'more' },
    })
  })

  it('nested param depth', () => {
    const router = setupRouter(['/:a', '/:a/:b', '/:a/:x/:b', '/:a/:y/:x/:b'])
    expect(findRoute(router, 'GET', '/a')).toMatchObject({
      data: { path: '/:a' },
      params: { a: 'a' },
    })
    expect(findRoute(router, 'GET', '/a/b')).toMatchObject({
      data: { path: '/:a/:b' },
      params: { a: 'a', b: 'b' },
    })
    expect(findRoute(router, 'GET', '/a/x/b')).toMatchObject({
      data: { path: '/:a/:x/:b' },
      params: { a: 'a', x: 'x', b: 'b' },
    })
  })
})

describe('wildcard routes', () => {
  it('catch-all wildcard', () => {
    const router = setupRouter(['/wildcard/**'])
    expect(findRoute(router, 'GET', '/wildcard/foo')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo' },
    })
    expect(findRoute(router, 'GET', '/wildcard/foo/bar')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo/bar' },
    })
  })

  it('named catch-all', () => {
    const router = setupRouter(['/polymer/**:id'])
    expect(findRoute(router, 'GET', '/polymer/anon')).toMatchObject({
      data: { path: '/polymer/**:id' },
      params: { id: 'anon' },
    })
    expect(findRoute(router, 'GET', '/polymer/foo/bar/baz')).toMatchObject({
      data: { path: '/polymer/**:id' },
      params: { id: 'foo/bar/baz' },
    })
  })

  it('single wildcard', () => {
    const router = setupRouter(['/blog/*'])
    expect(findRoute(router, 'GET', '/blog/123')).toMatchObject({
      data: { path: '/blog/*' },
    })
  })

  it('wildcard with static sibling', () => {
    const router = setupRouter(['/polymer/**', '/polymer/another/route'])
    expect(findRoute(router, 'GET', '/polymer/another/route')).toMatchObject({
      data: { path: '/polymer/another/route' },
    })
    expect(findRoute(router, 'GET', '/polymer/foo/bar')).toMatchObject({
      data: { path: '/polymer/**' },
      params: { _: 'foo/bar' },
    })
  })

  it('root catch-all', () => {
    const router = setupRouter(['/**'])
    expect(findRoute(router, 'GET', '/anything')).toMatchObject({
      data: { path: '/**' },
      params: { _: 'anything' },
    })
    expect(findRoute(router, 'GET', '/any/deep/path')).toMatchObject({
      data: { path: '/**' },
      params: { _: 'any/deep/path' },
    })
  })
})

describe('regex constraints', () => {
  it('numeric param', () => {
    const router = setupRouter(['/users/:id(\\d+)'])
    expect(findRoute(router, 'GET', '/users/123')).toMatchObject({
      data: { path: '/users/:id(\\d+)' },
      params: { id: '123' },
    })
    expect(findRoute(router, 'GET', '/users/abc')).toBeUndefined()
  })

  it('enum param', () => {
    const router = setupRouter(['/files/:ext(png|jpg|gif)'])
    expect(findRoute(router, 'GET', '/files/png')).toMatchObject({
      data: { path: '/files/:ext(png|jpg|gif)' },
      params: { ext: 'png' },
    })
    expect(findRoute(router, 'GET', '/files/pdf')).toBeUndefined()
  })

  it('regex + unconstrained coexist', () => {
    const router = setupRouter(['/users/:id(\\d+)', '/users/:slug'])
    expect(findRoute(router, 'GET', '/users/123')).toMatchObject({
      data: { path: '/users/:id(\\d+)' },
      params: { id: '123' },
    })
    expect(findRoute(router, 'GET', '/users/abc')).toMatchObject({
      data: { path: '/users/:slug' },
      params: { slug: 'abc' },
    })
  })
})

describe('optional params', () => {
  it(':name? at end', () => {
    const router = setupRouter(['/users/:id?'])
    expect(findRoute(router, 'GET', '/users/123')).toMatchObject({
      data: { path: '/users/:id?' },
      params: { id: '123' },
    })
    expect(findRoute(router, 'GET', '/users')).toMatchObject({
      data: { path: '/users/:id?' },
    })
  })
})

describe('method dispatch', () => {
  it('different methods on same path', () => {
    const router = createRouter<{ method: string }>()
    addRoute(router, 'GET', '/users', { method: 'GET' })
    addRoute(router, 'POST', '/users', { method: 'POST' })

    expect(findRoute(router, 'GET', '/users')).toMatchObject({ data: { method: 'GET' } })
    expect(findRoute(router, 'POST', '/users')).toMatchObject({ data: { method: 'POST' } })
    expect(findRoute(router, 'DELETE', '/users')).toBeUndefined()
  })
})

describe('remove routes', () => {
  it('removes static route', () => {
    const router = setupRouter(['/hello', '/cool'])
    expect(findRoute(router, 'GET', '/hello')).toBeDefined()
    removeRoute(router, 'GET', '/hello')
    expect(findRoute(router, 'GET', '/hello')).toBeUndefined()
    expect(findRoute(router, 'GET', '/cool')).toBeDefined()
  })

  it('removes wildcard route', () => {
    const router = setupRouter(['/ui/**', '/ui/components/**'])
    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/components/**' },
    })
    removeRoute(router, 'GET', '/ui/components/**')
    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/**' },
    })
  })
})
