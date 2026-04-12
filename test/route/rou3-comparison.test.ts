import { createRouter, addRoute, findRoute, removeRoute } from 'rou3'
/**
 * rou3 router — integration tests.
 *
 * Verifies that rou3 (used as Silgi's router) handles all
 * route patterns correctly: static, param, wildcard, method dispatch.
 */
import { describe, it, expect } from 'vitest'

// ── Helpers ─────────────────────────────────────────

function setup(paths: string[], method = 'GET') {
  const router = createRouter<{ path: string }>()
  for (const path of paths) addRoute(router, method, path, { path })
  return router
}

function assertLookups(
  router: ReturnType<typeof createRouter<{ path: string }>>,
  tests: Record<string, { data: { path: string }; params?: Record<string, string> } | undefined>,
) {
  for (const [path, expected] of Object.entries(tests)) {
    if (expected === undefined) {
      expect(findRoute(router, 'GET', path), `findRoute(GET, ${path})`).toBeUndefined()
    } else {
      expect(findRoute(router, 'GET', path), `findRoute(GET, ${path})`).toMatchObject(expected)
    }
  }
}

function testRouter(
  paths: string[],
  tests?: Record<string, { data: { path: string }; params?: Record<string, string> } | undefined>,
) {
  const router = setup(paths)
  const resolvedTests = tests ?? Object.fromEntries(paths.map((p) => [p, { data: { path: p } }]))
  assertLookups(router, resolvedTests)
}

// ═══════════════════════════════════════════════════
//  Static Routes
// ═══════════════════════════════════════════════════

describe('static routes', () => {
  it('exact matches', () => {
    testRouter(['/', '/route', '/another-router', '/this/is/yet/another/route'])
  })

  it('no match returns undefined', () => {
    const r = setup(['/', '/route'])
    expect(findRoute(r, 'GET', '/missing')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════
//  Trailing Slash
// ═══════════════════════════════════════════════════

describe('trailing slash normalization', () => {
  it('routes with and without trailing slash', () => {
    testRouter(['/route/without/trailing/slash', '/route/with/trailing/slash/'], {
      '/route/without/trailing/slash': { data: { path: '/route/without/trailing/slash' } },
      '/route/with/trailing/slash/': { data: { path: '/route/with/trailing/slash/' } },
      '/route/without/trailing/slash/': { data: { path: '/route/without/trailing/slash' } },
      '/route/with/trailing/slash': { data: { path: '/route/with/trailing/slash/' } },
    })
  })
})

// ═══════════════════════════════════════════════════
//  Parametric Routes
// ═══════════════════════════════════════════════════

describe('parametric routes', () => {
  it('single param', () => {
    testRouter(['/carbon/:element'], {
      '/carbon/test1': { data: { path: '/carbon/:element' }, params: { element: 'test1' } },
      '/carbon': undefined,
      '/carbon/': undefined,
    })
  })

  it('multiple params', () => {
    testRouter(['/carbon/:element/test/:testing'], {
      '/carbon/test2/test/test23': {
        data: { path: '/carbon/:element/test/:testing' },
        params: { element: 'test2', testing: 'test23' },
      },
    })
  })

  it('nested param depth', () => {
    testRouter(['/', '/:a', '/:a/:y/:x/:b', '/:a/:x/:b', '/:a/:b'], {
      '/': { data: { path: '/' } },
      '/a': { data: { path: '/:a' }, params: { a: 'a' } },
      '/a/b': { data: { path: '/:a/:b' }, params: { a: 'a', b: 'b' } },
      '/a/x/b': { data: { path: '/:a/:x/:b' }, params: { a: 'a', x: 'x', b: 'b' } },
      '/a/y/x/b': { data: { path: '/:a/:y/:x/:b' }, params: { a: 'a', y: 'y', x: 'x', b: 'b' } },
    })
  })

  it('blog wildcard *', () => {
    testRouter(['/blog/*'], {
      '/blog': { data: { path: '/blog/*' } },
      '/blog/': { data: { path: '/blog/*' } },
      '/blog/123': { data: { path: '/blog/*' } },
    })
  })
})

// ═══════════════════════════════════════════════════
//  Wildcard Routes
// ═══════════════════════════════════════════════════

describe('wildcard routes', () => {
  it('named catch-all **:name with static sibling', () => {
    testRouter(['/polymer/**:id', '/polymer/another/route'], {
      '/polymer/another/route': { data: { path: '/polymer/another/route' } },
      '/polymer/anon': { data: { path: '/polymer/**:id' }, params: { id: 'anon' } },
      '/polymer/foo/bar/baz': { data: { path: '/polymer/**:id' }, params: { id: 'foo/bar/baz' } },
    })
  })

  it('root catch-all /**', () => {
    testRouter(['/**'], {
      '/anything': { data: { path: '/**' }, params: { _: 'anything' } },
      '/any/deep/path': { data: { path: '/**' }, params: { _: 'any/deep/path' } },
    })
  })

  it('fallback to wildcard from static', () => {
    testRouter(['/wildcard/**', '/test/**', '/test'], {
      '/wildcard/abc': { data: { path: '/wildcard/**' }, params: { _: 'abc' } },
      '/wildcard/abc/def': { data: { path: '/wildcard/**' }, params: { _: 'abc/def' } },
      '/test': { data: { path: '/test' } },
      '/test/abc': { data: { path: '/test/**' }, params: { _: 'abc' } },
    })
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

    expect(findRoute(r, 'GET', '/users')!.data.method).toBe('GET')
    expect(findRoute(r, 'POST', '/users')!.data.method).toBe('POST')
    expect(findRoute(r, 'DELETE', '/users/123')).toMatchObject({
      data: { method: 'DELETE' },
      params: { id: '123' },
    })
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
//  Complex Mixed
// ═══════════════════════════════════════════════════

describe('complex mixed scenarios', () => {
  it('static + param + wildcard coexist', () => {
    const r = setup([
      '/test',
      '/test/:id',
      '/test/foo',
      '/test/foo/**',
      '/test/foo/bar/qux',
      '/another/path',
      '/wildcard/**',
      '/**',
    ])

    expect(findRoute(r, 'GET', '/test')).toMatchObject({ data: { path: '/test' } })
    expect(findRoute(r, 'GET', '/test/foo')).toMatchObject({ data: { path: '/test/foo' } })
    expect(findRoute(r, 'GET', '/test/123')).toMatchObject({ data: { path: '/test/:id' }, params: { id: '123' } })
    expect(findRoute(r, 'GET', '/test/foo/123/456')).toMatchObject({
      data: { path: '/test/foo/**' },
      params: { _: '123/456' },
    })
    expect(findRoute(r, 'GET', '/wildcard/foo')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo' },
    })
    expect(findRoute(r, 'GET', '/anything')).toMatchObject({ data: { path: '/**' }, params: { _: 'anything' } })
  })
})

// ═══════════════════════════════════════════════════
//  Remove Routes
// ═══════════════════════════════════════════════════

describe('remove routes', () => {
  it('removes static routes', () => {
    const router = setup(['/hello', '/cool'])

    removeRoute(router, 'GET', '/hello')
    expect(findRoute(router, 'GET', '/hello')).toBeUndefined()
    expect(findRoute(router, 'GET', '/cool')).toMatchObject({ data: { path: '/cool' } })
  })

  it('removes wildcard — falls back to parent', () => {
    const router = setup(['/ui/**', '/ui/components/**'])

    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/components/**' },
    })

    removeRoute(router, 'GET', '/ui/components/**')
    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/**' },
    })
  })
})
