/**
 * Router tests — comprehensive test suite ported from rou3.
 *
 * Every test case exercises both `findRoute` (interpreted) and the
 * JIT-compiled lookup returned by `compileRouter`.
 */
import { describe, it, expect } from 'vitest'

import { createRouter, addRoute, findRoute, removeRoute, compileRouter } from '#src/route/index.ts'

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

type TestRoute = {
  data: { path: string }
  params?: Record<string, string>
}

type TestRoutes = Record<string, TestRoute | undefined>

/** Create a router, add every path as a GET route with `{ path }` data. */
function setup(paths: string[], method = 'GET') {
  const router = createRouter<{ path: string }>()
  for (const path of paths) addRoute(router, method, path, { path })
  return router
}

/**
 * For every entry in `tests`, assert that both `findRoute` and the compiled
 * lookup return the expected result (or `undefined` when the value is
 * `undefined`).
 */
function assertLookups(
  router: ReturnType<typeof createRouter<{ path: string }>>,
  tests: TestRoutes,
) {
  const compiled = compileRouter(router)

  for (const [path, expected] of Object.entries(tests)) {
    if (expected === undefined) {
      expect(findRoute(router, 'GET', path), `findRoute(GET, ${path})`).toBeUndefined()
      expect(compiled('GET', path), `compiled(GET, ${path})`).toBeUndefined()
    } else {
      expect(findRoute(router, 'GET', path), `findRoute(GET, ${path})`).toMatchObject(expected)
      expect(compiled('GET', path), `compiled(GET, ${path})`).toMatchObject(expected)
    }
  }
}

/**
 * Shorthand: create a router from `paths`, then run `assertLookups`.
 * When `tests` is omitted every path is expected to match itself.
 */
function testRouter(paths: string[], tests?: TestRoutes) {
  const router = setup(paths)
  const resolvedTests: TestRoutes = tests ??
    Object.fromEntries(paths.map((p) => [p, { data: { path: p } }]))
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
    const compiled = compileRouter(r)
    expect(findRoute(r, 'GET', '/missing')).toBeUndefined()
    expect(compiled('GET', '/missing')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════
//  Trailing Slash
// ═══════════════════════════════════════════════════

describe('trailing slash normalization', () => {
  it('routes with and without trailing slash', () => {
    testRouter(
      ['/route/without/trailing/slash', '/route/with/trailing/slash/'],
      {
        '/route/without/trailing/slash': {
          data: { path: '/route/without/trailing/slash' },
        },
        '/route/with/trailing/slash/': {
          data: { path: '/route/with/trailing/slash/' },
        },
        '/route/without/trailing/slash/': {
          data: { path: '/route/without/trailing/slash' },
        },
        '/route/with/trailing/slash': {
          data: { path: '/route/with/trailing/slash/' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Empty Segments
// ═══════════════════════════════════════════════════

describe('empty segments', () => {
  it('double slash segment', () => {
    testRouter(
      ['/test//route', '/test/:param/route'],
      {
        '/test//route': {
          data: { path: '/test//route' },
        },
        '/test/id/route': {
          data: { path: '/test/:param/route' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Parametric Routes
// ═══════════════════════════════════════════════════

describe('parametric routes', () => {
  it('single param', () => {
    testRouter(
      ['/carbon/:element'],
      {
        '/carbon/test1': {
          data: { path: '/carbon/:element' },
          params: { element: 'test1' },
        },
        '/carbon': undefined,
        '/carbon/': undefined,
      },
    )
  })

  it('multiple params across segments', () => {
    testRouter(
      ['/carbon/:element/test/:testing'],
      {
        '/carbon/test2/test/test23': {
          data: { path: '/carbon/:element/test/:testing' },
          params: { element: 'test2', testing: 'test23' },
        },
      },
    )
  })

  it('params between static segments', () => {
    testRouter(
      ['/this/:route/has/:cool/stuff'],
      {
        '/this/test/has/more/stuff': {
          data: { path: '/this/:route/has/:cool/stuff' },
          params: { route: 'test', cool: 'more' },
        },
      },
    )
  })

  it('blog wildcard *', () => {
    testRouter(
      ['/blog/*'],
      {
        '/blog': { data: { path: '/blog/*' } },
        '/blog/': { data: { path: '/blog/*' } },
        '/blog/123': { data: { path: '/blog/*' } },
      },
    )
  })

  it('mixed param routes together', () => {
    testRouter(
      [
        '/blog/*',
        '/carbon/:element',
        '/carbon/:element/test/:testing',
        '/this/:route/has/:cool/stuff',
      ],
      {
        '/carbon/test1': {
          data: { path: '/carbon/:element' },
          params: { element: 'test1' },
        },
        '/carbon': undefined,
        '/carbon/': undefined,
        '/carbon/test2/test/test23': {
          data: { path: '/carbon/:element/test/:testing' },
          params: { element: 'test2', testing: 'test23' },
        },
        '/this/test/has/more/stuff': {
          data: { path: '/this/:route/has/:cool/stuff' },
          params: { route: 'test', cool: 'more' },
        },
        '/blog': { data: { path: '/blog/*' } },
        '/blog/': { data: { path: '/blog/*' } },
        '/blog/123': { data: { path: '/blog/*' } },
      },
    )
  })

  it('nested param depth (/:a, /:a/:b, etc.)', () => {
    testRouter(
      ['/', '/:a', '/:a/:y/:x/:b', '/:a/:x/:b', '/:a/:b'],
      {
        '/': { data: { path: '/' } },
        '/a': {
          data: { path: '/:a' },
          params: { a: 'a' },
        },
        '/a/b': {
          data: { path: '/:a/:b' },
          params: { a: 'a', b: 'b' },
        },
        '/a/x/b': {
          data: { path: '/:a/:x/:b' },
          params: { a: 'a', x: 'x', b: 'b' },
        },
        '/a/y/x/b': {
          data: { path: '/:a/:y/:x/:b' },
          params: { a: 'a', y: 'y', x: 'x', b: 'b' },
        },
      },
    )
  })

  it('complex nested params (GitHub-like)', () => {
    testRouter(
      [
        '/',
        '/:packageAndRefOrSha',
        '/:owner/:repo/',
        '/:owner/:repo/:packageAndRefOrSha',
        '/:owner/:repo/:npmOrg/:packageAndRefOrSha',
      ],
      {
        '/tinylibs/tinybench/tiny@232': {
          data: { path: '/:owner/:repo/:packageAndRefOrSha' },
          params: {
            owner: 'tinylibs',
            repo: 'tinybench',
            packageAndRefOrSha: 'tiny@232',
          },
        },
        '/tinylibs/tinybench/@tinylibs/tiny@232': {
          data: { path: '/:owner/:repo/:npmOrg/:packageAndRefOrSha' },
          params: {
            owner: 'tinylibs',
            repo: 'tinybench',
            npmOrg: '@tinylibs',
            packageAndRefOrSha: 'tiny@232',
          },
        },
      },
    )
  })

  it('hyphenated param names', () => {
    testRouter(
      ['/users/:user-id', '/users/:user-id/posts/:post-id', '/items/:item-name/details'],
      {
        '/users/123': {
          data: { path: '/users/:user-id' },
          params: { 'user-id': '123' },
        },
        '/users/abc/posts/456': {
          data: { path: '/users/:user-id/posts/:post-id' },
          params: { 'user-id': 'abc', 'post-id': '456' },
        },
        '/items/widget/details': {
          data: { path: '/items/:item-name/details' },
          params: { 'item-name': 'widget' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Wildcard Routes
// ═══════════════════════════════════════════════════

describe('wildcard routes', () => {
  it('named catch-all **:name with static sibling', () => {
    testRouter(
      ['/polymer/**:id', '/polymer/another/route', '/route/:p1/something/**:rest'],
      {
        '/polymer/another/route': { data: { path: '/polymer/another/route' } },
        '/polymer/anon': {
          data: { path: '/polymer/**:id' },
          params: { id: 'anon' },
        },
        '/polymer/foo/bar/baz': {
          data: { path: '/polymer/**:id' },
          params: { id: 'foo/bar/baz' },
        },
        '/route/param1/something/c/d': {
          data: { path: '/route/:p1/something/**:rest' },
          params: { p1: 'param1', rest: 'c/d' },
        },
      },
    )
  })

  it('root catch-all /**', () => {
    testRouter(
      ['/**'],
      {
        '/anything': {
          data: { path: '/**' },
          params: { _: 'anything' },
        },
        '/any/deep/path': {
          data: { path: '/**' },
          params: { _: 'any/deep/path' },
        },
      },
    )
  })

  it('fallback to wildcard from static', () => {
    testRouter(
      ['/wildcard/**', '/test/**', '/test', '/dynamic/*'],
      {
        '/wildcard': {
          data: { path: '/wildcard/**' },
        },
        '/wildcard/': {
          data: { path: '/wildcard/**' },
        },
        '/wildcard/abc': {
          data: { path: '/wildcard/**' },
          params: { _: 'abc' },
        },
        '/wildcard/abc/def': {
          data: { path: '/wildcard/**' },
          params: { _: 'abc/def' },
        },
        '/dynamic': {
          data: { path: '/dynamic/*' },
        },
        '/test': {
          data: { path: '/test' },
        },
        '/test/': {
          data: { path: '/test' },
        },
        '/test/abc': {
          data: { path: '/test/**' },
          params: { _: 'abc' },
        },
      },
    )
  })

  it('unnamed placeholders', () => {
    testRouter(
      ['/polymer/**', '/polymer/route/*'],
      {
        '/polymer/foo/bar': {
          data: { path: '/polymer/**' },
          params: { _: 'foo/bar' },
        },
        '/polymer/route/anon': {
          data: { path: '/polymer/route/*' },
          params: { '0': 'anon' },
        },
        '/polymer/constructor': {
          data: { path: '/polymer/**' },
          params: { _: 'constructor' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Mixed Params in Same Segment
// ═══════════════════════════════════════════════════

describe('mixed params in same segment', () => {
  it(':category/:id,name=:name.txt', () => {
    const mixedPath = '/files/:category/:id,name=:name.txt'
    testRouter(
      [mixedPath],
      {
        '/files/test/123,name=foobar.txt': {
          data: { path: mixedPath },
          params: { category: 'test', id: '123', name: 'foobar' },
        },
        '/files/test': undefined,
      },
    )
  })

  it('prefix @:param coexists with :param', () => {
    testRouter(
      ['/npm/:param1/:param2', '/npm/@:param1/:param2'],
      {
        '/npm/@test/123': {
          data: { path: '/npm/@:param1/:param2' },
          params: { param1: 'test', param2: '123' },
        },
        '/npm/test/123': {
          data: { path: '/npm/:param1/:param2' },
          params: { param1: 'test', param2: '123' },
        },
      },
    )
  })

  it('prefix @:param only (no plain)', () => {
    testRouter(
      ['/npm/@:param1/:param2'],
      {
        '/npm/@test/123': {
          data: { path: '/npm/@:param1/:param2' },
          params: { param1: 'test', param2: '123' },
        },
        '/npm/test/123': undefined,
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Regex Constraints — Named
// ═══════════════════════════════════════════════════

describe('regex constraints (named)', () => {
  it('numeric param :id(\\d+)', () => {
    testRouter(
      ['/users/:id(\\d+)'],
      {
        '/users/123': {
          data: { path: '/users/:id(\\d+)' },
          params: { id: '123' },
        },
        '/users/abc': undefined,
      },
    )
  })

  it('enum param :ext(png|jpg|gif)', () => {
    testRouter(
      ['/files/:ext(png|jpg|gif)'],
      {
        '/files/png': {
          data: { path: '/files/:ext(png|jpg|gif)' },
          params: { ext: 'png' },
        },
        '/files/jpg': {
          data: { path: '/files/:ext(png|jpg|gif)' },
          params: { ext: 'jpg' },
        },
        '/files/pdf': undefined,
      },
    )
  })

  it('versioned API :version(v\\d+)/:resource', () => {
    testRouter(
      ['/api/:version(v\\d+)/:resource'],
      {
        '/api/v2/users': {
          data: { path: '/api/:version(v\\d+)/:resource' },
          params: { version: 'v2', resource: 'users' },
        },
        '/api/latest/users': undefined,
      },
    )
  })

  it('regex + unconstrained coexist', () => {
    testRouter(
      ['/users/:id(\\d+)', '/users/:slug'],
      {
        '/users/123': {
          data: { path: '/users/:id(\\d+)' },
          params: { id: '123' },
        },
        '/users/abc': {
          data: { path: '/users/:slug' },
          params: { slug: 'abc' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Regex Constraints — Unnamed Groups
// ═══════════════════════════════════════════════════

describe('regex constraints (unnamed groups)', () => {
  it('unnamed (\\d+)', () => {
    testRouter(
      ['/path/(\\d+)'],
      {
        '/path/123': {
          data: { path: '/path/(\\d+)' },
          params: { '0': '123' },
        },
        '/path/abc': undefined,
      },
    )
  })

  it('unnamed enum (png|jpg|gif)', () => {
    testRouter(
      ['/files/(png|jpg|gif)'],
      {
        '/files/png': {
          data: { path: '/files/(png|jpg|gif)' },
          params: { '0': 'png' },
        },
        '/files/jpg': {
          data: { path: '/files/(png|jpg|gif)' },
          params: { '0': 'jpg' },
        },
        '/files/pdf': undefined,
      },
    )
  })

  it('unnamed (\\d+) with trailing static', () => {
    testRouter(
      ['/path/(\\d+)/foo'],
      {
        '/path/123/foo': {
          data: { path: '/path/(\\d+)/foo' },
          params: { '0': '123' },
        },
        '/path/abc/foo': undefined,
      },
    )
  })

  it('multi-unnamed groups across segments', () => {
    testRouter(
      ['/path/(\\d+)/(\\w+)'],
      {
        '/path/123/abc': {
          data: { path: '/path/(\\d+)/(\\w+)' },
          params: { '0': '123', '1': 'abc' },
        },
        '/path/abc/abc': undefined,
        '/path/123/!': undefined,
      },
    )
  })

  it('unnamed regex + unconstrained param coexist', () => {
    testRouter(
      ['/path/(\\d+)', '/path/:slug'],
      {
        '/path/123': {
          data: { path: '/path/(\\d+)' },
          params: { '0': '123' },
        },
        '/path/abc': {
          data: { path: '/path/:slug' },
          params: { slug: 'abc' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Wildcard Segment Patterns
// ═══════════════════════════════════════════════════

describe('wildcard segment patterns', () => {
  it('*.png suffix', () => {
    testRouter(
      ['/files/*.png'],
      {
        '/files/logo.png': {
          data: { path: '/files/*.png' },
          params: { '0': 'logo' },
        },
        '/files/icon.jpg': undefined,
      },
    )
  })

  it('file-*-*.png double wildcard', () => {
    testRouter(
      ['/files/file-*-*.png'],
      {
        '/files/file-a-b.png': {
          data: { path: '/files/file-*-*.png' },
          params: { '0': 'a', '1': 'b' },
        },
        '/files/file-a.png': undefined,
      },
    )
  })

  it('combo *.png/*-v cross-segment', () => {
    testRouter(
      ['/combo/*.png/*-v'],
      {
        '/combo/logo.png/abc-v': {
          data: { path: '/combo/*.png/*-v' },
          params: { '0': 'logo', '1': 'abc' },
        },
        '/combo/logo.png/v': undefined,
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  URL Pattern Modifiers
// ═══════════════════════════════════════════════════

describe('url pattern modifiers', () => {
  it(':name? — optional at end', () => {
    testRouter(
      ['/users/:id?'],
      {
        '/users/123': {
          data: { path: '/users/:id?' },
          params: { id: '123' },
        },
        '/users': {
          data: { path: '/users/:id?' },
        },
      },
    )
  })

  it(':name? — optional mid-path', () => {
    testRouter(
      ['/api/:version?/users'],
      {
        '/api/v2/users': {
          data: { path: '/api/:version?/users' },
          params: { version: 'v2' },
        },
        '/api/users': {
          data: { path: '/api/:version?/users' },
        },
      },
    )
  })

  it(':name(regex)? — optional with regex constraint', () => {
    testRouter(
      ['/users/:id(\\d+)?'],
      {
        '/users/123': {
          data: { path: '/users/:id(\\d+)?' },
          params: { id: '123' },
        },
        '/users': {
          data: { path: '/users/:id(\\d+)?' },
        },
        '/users/abc': undefined,
      },
    )
  })

  it(':name+ — one or more segments', () => {
    testRouter(
      ['/files/:path+'],
      {
        '/files/a/b/c': {
          data: { path: '/files/:path+' },
          params: { path: 'a/b/c' },
        },
        '/files/a': {
          data: { path: '/files/:path+' },
          params: { path: 'a' },
        },
        '/files': undefined,
      },
    )
  })

  it(':name* — zero or more segments', () => {
    testRouter(
      ['/files/:path*'],
      {
        '/files/a/b/c': {
          data: { path: '/files/:path*' },
          params: { path: 'a/b/c' },
        },
        '/files/a': {
          data: { path: '/files/:path*' },
          params: { path: 'a' },
        },
        '/files': {
          data: { path: '/files/:path*' },
        },
      },
    )
  })
})

// ═══════════════════════════════════════════════════
//  Non-Capturing Groups
// ═══════════════════════════════════════════════════

describe('non-capturing groups', () => {
  it('/book{s}? — optional literal suffix', () => {
    testRouter(
      ['/book{s}?'],
      {
        '/book': {
          data: { path: '/book{s}?' },
        },
        '/books': {
          data: { path: '/book{s}?' },
        },
        '/bookss': undefined,
      },
    )
  })

  it('/blog/:id(\\d+){-:title}? — optional group with param', () => {
    testRouter(
      ['/blog/:id(\\d+){-:title}?'],
      {
        '/blog/123': {
          data: { path: '/blog/:id(\\d+){-:title}?' },
          params: { id: '123' },
        },
        '/blog/123-my-post': {
          data: { path: '/blog/:id(\\d+){-:title}?' },
          params: { id: '123', title: 'my-post' },
        },
        '/blog/my-post': undefined,
      },
    )
  })

  it('/foo{/bar}? — optional literal segment', () => {
    testRouter(
      ['/foo{/bar}?'],
      {
        '/foo': {
          data: { path: '/foo{/bar}?' },
        },
        '/foo/bar': {
          data: { path: '/foo{/bar}?' },
        },
        '/foo/baz': undefined,
      },
    )
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

    const compiled = compileRouter(r)

    expect(findRoute(r, 'GET', '/users')).toMatchObject({ data: { method: 'GET' } })
    expect(findRoute(r, 'POST', '/users')).toMatchObject({ data: { method: 'POST' } })
    expect(findRoute(r, 'DELETE', '/users/123')).toMatchObject({
      data: { method: 'DELETE' },
      params: { id: '123' },
    })
    expect(findRoute(r, 'PATCH', '/users')).toBeUndefined()

    expect(compiled('GET', '/users')).toMatchObject({ data: { method: 'GET' } })
    expect(compiled('POST', '/users')).toMatchObject({ data: { method: 'POST' } })
    expect(compiled('DELETE', '/users/123')).toMatchObject({
      data: { method: 'DELETE' },
      params: { id: '123' },
    })
    expect(compiled('PATCH', '/users')).toBeUndefined()
  })

  it('empty method matches any', () => {
    const r = createRouter<{ path: string }>()
    addRoute(r, '', '/fallback', { path: '/fallback' })

    const compiled = compileRouter(r)

    expect(findRoute(r, 'GET', '/fallback')).toMatchObject({ data: { path: '/fallback' } })
    expect(findRoute(r, 'POST', '/fallback')).toMatchObject({ data: { path: '/fallback' } })

    expect(compiled('GET', '/fallback')).toMatchObject({ data: { path: '/fallback' } })
    expect(compiled('POST', '/fallback')).toMatchObject({ data: { path: '/fallback' } })
  })
})

// ═══════════════════════════════════════════════════
//  Router Insert
// ═══════════════════════════════════════════════════

describe('router insert', () => {
  it('inserts nodes correctly and supports override via empty method', () => {
    const router = setup([
      '/hello',
      '/cool',
      '/hi',
      '/helium',
      '/choo',
      '/coooool',
      '/chrome',
      '/choot',
      '/choot/:choo',
      '/ui/**',
      '/ui/components/**',
      '/api/v1',
      '/api/v2',
      '/api/v3',
    ])

    // Override /api/v3 with empty method (matches all)
    addRoute(router, '', '/api/v3', { path: '/api/v3(overridden)' })

    const compiled = compileRouter(router)

    // The GET route should still match
    expect(findRoute(router, 'GET', '/api/v3')).toMatchObject({ data: { path: '/api/v3' } })
    expect(compiled('GET', '/api/v3')).toMatchObject({ data: { path: '/api/v3' } })

    // The empty-method override should match other methods
    expect(findRoute(router, 'POST', '/api/v3')).toMatchObject({
      data: { path: '/api/v3(overridden)' },
    })
    expect(compiled('POST', '/api/v3')).toMatchObject({
      data: { path: '/api/v3(overridden)' },
    })

    // Param routes
    expect(findRoute(router, 'GET', '/choot/val')).toMatchObject({
      data: { path: '/choot/:choo' },
      params: { choo: 'val' },
    })
    expect(compiled('GET', '/choot/val')).toMatchObject({
      data: { path: '/choot/:choo' },
      params: { choo: 'val' },
    })

    // Wildcard routes
    expect(findRoute(router, 'GET', '/ui/components/buttons')).toMatchObject({
      data: { path: '/ui/components/**' },
      params: { _: 'buttons' },
    })
    expect(compiled('GET', '/ui/components/buttons')).toMatchObject({
      data: { path: '/ui/components/**' },
      params: { _: 'buttons' },
    })
  })
})

// ═══════════════════════════════════════════════════
//  Remove Routes
// ═══════════════════════════════════════════════════

describe('remove routes', () => {
  it('removes static routes', () => {
    const router = setup([
      '/hello',
      '/cool',
      '/hi',
      '/helium',
      '/coooool',
      '/chrome',
      '/choot',
      '/choot/:choo',
      '/ui/**',
      '/ui/components/**',
    ])

    removeRoute(router, 'GET', 'choot')
    expect(findRoute(router, 'GET', 'choot')).toBeUndefined()

    removeRoute(router, 'GET', 'choot/*')
    expect(findRoute(router, 'GET', 'choot')).toBeUndefined()
  })

  it('removes wildcard route — falls back to parent wildcard', () => {
    const router = setup([
      '/hello',
      '/cool',
      '/hi',
      '/helium',
      '/coooool',
      '/chrome',
      '/choot',
      '/choot/:choo',
      '/ui/**',
      '/ui/components/**',
    ])

    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/components/**' },
      params: { _: 'snackbars' },
    })

    removeRoute(router, 'GET', '/ui/components/**')
    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/**' },
      params: { _: 'components/snackbars' },
    })
  })

  it('removes data but preserves node if it has children', () => {
    const router = setup(['/a/b', '/a/b/*'])

    removeRoute(router, 'GET', '/a/b')
    expect(findRoute(router, 'GET', '/a/b')).toMatchObject({
      data: { path: '/a/b/*' },
      params: { '0': undefined },
    })
    expect(findRoute(router, 'GET', '/a/b/c')).toMatchObject({
      params: { '0': 'c' },
      data: { path: '/a/b/*' },
    })

    removeRoute(router, 'GET', '/a/b/*')
    expect(findRoute(router, 'GET', '/a/b')).toBeUndefined()
  })

  it('placeholder routes survive after removal of siblings', () => {
    const router = setup(['/placeholder/:choo', '/placeholder/:choo/:choo2'])

    expect(findRoute(router, 'GET', '/placeholder/route')).toMatchObject({
      data: { path: '/placeholder/:choo' },
      params: { choo: 'route' },
    })

    expect(findRoute(router, 'GET', '/placeholder/route/route2')).toMatchObject({
      data: { path: '/placeholder/:choo/:choo2' },
      params: { choo: 'route', choo2: 'route2' },
    })
  })

  it('removes wildcard routes (standalone test)', () => {
    const router = setup(['/ui/**', '/ui/components/**'])

    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/components/**' },
      params: { _: 'snackbars' },
    })

    removeRoute(router, 'GET', '/ui/components/**')
    expect(findRoute(router, 'GET', '/ui/components/snackbars')).toMatchObject({
      data: { path: '/ui/**' },
      params: { _: 'components/snackbars' },
    })
  })

  it('removes named wildcard routes', () => {
    const route = '/user/**:id'
    const router = setup([route])

    removeRoute(router, 'GET', route)

    expect(findRoute(router, 'GET', '/user/123')).toBeUndefined()
    expect(findRoute(router, 'GET', '/user/wildcard')).toBeUndefined()
  })

  it('removes wildcard segment patterns', () => {
    const route = '/assets/*.png'
    const router = setup([route])

    expect(findRoute(router, 'GET', '/assets/logo.png')).toMatchObject({
      data: { path: route },
      params: { '0': 'logo' },
    })

    removeRoute(router, 'GET', route)

    expect(findRoute(router, 'GET', '/assets/logo.png')).toBeUndefined()
  })

  it('removes optional modifier routes (:name?)', () => {
    const route = '/users/:id?'
    const router = setup([route])

    expect(findRoute(router, 'GET', '/users/123')).toMatchObject({
      data: { path: route },
      params: { id: '123' },
    })
    expect(findRoute(router, 'GET', '/users')).toMatchObject({
      data: { path: route },
    })

    removeRoute(router, 'GET', route)

    expect(findRoute(router, 'GET', '/users/123')).toBeUndefined()
    expect(findRoute(router, 'GET', '/users')).toBeUndefined()
  })

  it('removes one-or-more modifier routes (:name+)', () => {
    const route = '/files/:path+'
    const router = setup([route])

    expect(findRoute(router, 'GET', '/files/a/b/c')).toMatchObject({
      data: { path: route },
      params: { path: 'a/b/c' },
    })

    removeRoute(router, 'GET', route)

    expect(findRoute(router, 'GET', '/files/a/b/c')).toBeUndefined()
  })

  it('removes zero-or-more modifier routes (:name*)', () => {
    const route = '/files/:path*'
    const router = setup([route])

    expect(findRoute(router, 'GET', '/files/a/b/c')).toMatchObject({
      data: { path: route },
      params: { path: 'a/b/c' },
    })
    expect(findRoute(router, 'GET', '/files')).toMatchObject({
      data: { path: route },
    })

    removeRoute(router, 'GET', route)

    expect(findRoute(router, 'GET', '/files/a/b/c')).toBeUndefined()
    expect(findRoute(router, 'GET', '/files')).toBeUndefined()
  })

  it('remove works on complex mixed router', () => {
    const router = setup([
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

    removeRoute(router, 'GET', '/test')
    removeRoute(router, 'GET', '/test/*')
    removeRoute(router, 'GET', '/test/foo/*')
    removeRoute(router, 'GET', '/test/foo/**')
    removeRoute(router, 'GET', '/**')

    expect(findRoute(router, 'GET', '/test')).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════
//  Complex Mixed Scenarios (from find.test.ts)
// ═══════════════════════════════════════════════════

describe('mixed scenarios (find.test.ts)', () => {
  it('static + param + wildcard coexist', () => {
    const router = setup([
      '/test',
      '/test/:id',
      '/test/:idYZ/y/z',
      '/test/:idY/y',
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

    const compiled = compileRouter(router)

    // --- Static ---
    expect(findRoute(router, 'GET', '/test')).toMatchObject({ data: { path: '/test' } })
    expect(compiled('GET', '/test')).toMatchObject({ data: { path: '/test' } })

    expect(findRoute(router, 'GET', '/test/foo')).toMatchObject({ data: { path: '/test/foo' } })
    expect(compiled('GET', '/test/foo')).toMatchObject({ data: { path: '/test/foo' } })

    expect(findRoute(router, 'GET', '/test/fooo')).toMatchObject({ data: { path: '/test/fooo' } })
    expect(compiled('GET', '/test/fooo')).toMatchObject({ data: { path: '/test/fooo' } })

    expect(findRoute(router, 'GET', '/another/path')).toMatchObject({
      data: { path: '/another/path' },
    })
    expect(compiled('GET', '/another/path')).toMatchObject({ data: { path: '/another/path' } })

    // --- Param ---
    expect(findRoute(router, 'GET', '/test/123')).toMatchObject({
      data: { path: '/test/:id' },
      params: { id: '123' },
    })
    expect(compiled('GET', '/test/123')).toMatchObject({
      data: { path: '/test/:id' },
      params: { id: '123' },
    })

    expect(findRoute(router, 'GET', '/test/123/y')).toMatchObject({
      data: { path: '/test/:idY/y' },
      params: { idY: '123' },
    })
    expect(compiled('GET', '/test/123/y')).toMatchObject({
      data: { path: '/test/:idY/y' },
      params: { idY: '123' },
    })

    expect(findRoute(router, 'GET', '/test/123/y/z')).toMatchObject({
      data: { path: '/test/:idYZ/y/z' },
      params: { idYZ: '123' },
    })
    expect(compiled('GET', '/test/123/y/z')).toMatchObject({
      data: { path: '/test/:idYZ/y/z' },
      params: { idYZ: '123' },
    })

    expect(findRoute(router, 'GET', '/test/foo/123')).toMatchObject({
      data: { path: '/test/foo/*' },
      params: { '0': '123' },
    })
    expect(compiled('GET', '/test/foo/123')).toMatchObject({
      data: { path: '/test/foo/*' },
      params: { '0': '123' },
    })

    // --- Wildcard ---
    expect(findRoute(router, 'GET', '/test/foo/123/456')).toMatchObject({
      data: { path: '/test/foo/**' },
      params: { _: '123/456' },
    })
    expect(compiled('GET', '/test/foo/123/456')).toMatchObject({
      data: { path: '/test/foo/**' },
      params: { _: '123/456' },
    })

    expect(findRoute(router, 'GET', '/wildcard/foo')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo' },
    })
    expect(compiled('GET', '/wildcard/foo')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo' },
    })

    expect(findRoute(router, 'GET', '/wildcard/foo/bar')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo/bar' },
    })
    expect(compiled('GET', '/wildcard/foo/bar')).toMatchObject({
      data: { path: '/wildcard/**' },
      params: { _: 'foo/bar' },
    })

    expect(findRoute(router, 'GET', '/wildcard')).toMatchObject({
      data: { path: '/wildcard/**' },
    })
    expect(compiled('GET', '/wildcard')).toMatchObject({
      data: { path: '/wildcard/**' },
    })

    // --- Root wildcard ---
    expect(findRoute(router, 'GET', '/anything')).toMatchObject({
      data: { path: '/**' },
      params: { _: 'anything' },
    })
    expect(compiled('GET', '/anything')).toMatchObject({
      data: { path: '/**' },
      params: { _: 'anything' },
    })

    expect(findRoute(router, 'GET', '/any/deep/path')).toMatchObject({
      data: { path: '/**' },
      params: { _: 'any/deep/path' },
    })
    expect(compiled('GET', '/any/deep/path')).toMatchObject({
      data: { path: '/**' },
      params: { _: 'any/deep/path' },
    })
  })

  it('escaped special characters', () => {
    const router = setup(['/static\\:path/\\*/\\*\\*'])
    const compiled = compileRouter(router)

    expect(findRoute(router, 'GET', '/static:path/*/**')).toMatchObject({
      data: { path: '/static\\:path/\\*/\\*\\*' },
    })
    expect(compiled('GET', '/static:path/*/**')).toMatchObject({
      data: { path: '/static\\:path/\\*/\\*\\*' },
    })
  })

  it('remove works on mixed router', () => {
    const router = setup([
      '/test',
      '/test/:id',
      '/test/:idYZ/y/z',
      '/test/:idY/y',
      '/test/foo',
      '/test/foo/*',
      '/test/foo/**',
      '/test/foo/bar/qux',
      '/test/foo/baz',
      '/test/fooo',
      '/another/path',
      '/wildcard/**',
      '/static\\:path/\\*/\\*\\*',
      '/**',
    ])

    removeRoute(router, 'GET', '/test')
    removeRoute(router, 'GET', '/test/*')
    removeRoute(router, 'GET', '/test/foo/*')
    removeRoute(router, 'GET', '/test/foo/**')
    removeRoute(router, 'GET', '/**')

    expect(findRoute(router, 'GET', '/test')).toBeUndefined()
  })
})
