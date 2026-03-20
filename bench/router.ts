/**
 * Router benchmark — Silgi compiled vs rou3 compiled.
 *
 * Run: node --experimental-strip-types bench/router.ts
 */

import { bench, run, summary, compact } from 'mitata'
import { createRouter as rou3Create, addRoute as rou3Add } from 'rou3'
import { compileRouter as rou3Compile } from 'rou3/compiler'

import { createRouter, addRoute, compileRouter } from '../src/route/index.ts'

// ── Routes ──────────────────────────────────────────

const paths = [
  '/users',
  '/users/list',
  '/posts',
  '/posts/list',
  '/api/v1/health',
  '/api/v1/config',
  '/admin/dashboard',
  '/admin/settings',
  '/users/:id',
  '/users/:id/posts',
  '/users/:id/posts/:postId',
  '/api/v1/:resource',
  '/api/v1/:resource/:id',
  '/files/**',
  '/assets/**',
  '/cdn/**:path',
]

// Silgi
const kr = createRouter()
for (const p of paths) addRoute(kr, 'GET', p, { path: p })
const kc = compileRouter(kr)

// rou3
const rr = rou3Create()
for (const p of paths) rou3Add(rr, 'GET', p, { path: p })
const rc = rou3Compile(rr)

// Verify
for (const [path, label] of [
  ['/users/list', 'static'],
  ['/users/123', 'param'],
  ['/files/a/b', 'wildcard'],
] as const) {
  const km = kc('GET', path)
  const rm = rc('GET', path)
  if (!km || !rm) console.error(`FAIL ${label}: silgi=${!!km} rou3=${!!rm}`)
}

// ── Benchmarks ──────────────────────────────────────

summary(() => {
  compact(() => {
    bench('silgi: static /users/list', () => kc('GET', '/users/list'))
    bench('rou3:   static /users/list', () => rc('GET', '/users/list'))
  })
})

summary(() => {
  compact(() => {
    bench('silgi: param /users/123', () => kc('GET', '/users/123'))
    bench('rou3:   param /users/123', () => rc('GET', '/users/123'))
  })
})

summary(() => {
  compact(() => {
    bench('silgi: deep /users/1/posts/2', () => kc('GET', '/users/1/posts/2'))
    bench('rou3:   deep /users/1/posts/2', () => rc('GET', '/users/1/posts/2'))
  })
})

summary(() => {
  compact(() => {
    bench('silgi: wildcard /files/a/b/c', () => kc('GET', '/files/a/b/c'))
    bench('rou3:   wildcard /files/a/b/c', () => rc('GET', '/files/a/b/c'))
  })
})

summary(() => {
  compact(() => {
    bench('silgi: miss /missing/deep', () => kc('GET', '/missing/deep'))
    bench('rou3:   miss /missing/deep', () => rc('GET', '/missing/deep'))
  })
})

await run()
