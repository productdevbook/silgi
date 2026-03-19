/**
 * Benchmark: Katman Router vs rou3
 *
 * Run: node --experimental-strip-types bench/router-vs-rou3.ts
 */

import { bench, run, summary, compact } from 'mitata'

// Katman router
import { createRouter as katmanCreate, addRoute as katmanAdd, findRoute as katmanFind } from '../src/route/index.ts'

// rou3
import { createRouter as rou3Create, addRoute as rou3Add, findRoute as rou3Find } from 'rou3'

// ── Setup routes ────────────────────────────────────

const staticPaths = [
  '/users',
  '/users/list',
  '/posts',
  '/posts/list',
  '/api/v1/health',
  '/api/v1/config',
  '/admin/dashboard',
  '/admin/settings',
]

const paramPaths = [
  '/users/:id',
  '/users/:id/posts',
  '/users/:id/posts/:postId',
  '/api/v1/:resource',
  '/api/v1/:resource/:id',
]

const wildcardPaths = ['/files/**', '/assets/**', '/cdn/**:path']

const allPaths = [...staticPaths, ...paramPaths, ...wildcardPaths]

// Katman router
const kr = katmanCreate()
for (const p of allPaths) katmanAdd(kr, 'GET', p, { path: p })

// rou3 router
const rr = rou3Create()
for (const p of allPaths) rou3Add(rr, 'GET', p, { path: p })

// ═══════════════════════════════════════════════════
//  Static route lookup
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('katman: static /users/list', () => katmanFind(kr, 'GET', '/users/list'))
    bench('rou3:   static /users/list', () => rou3Find(rr, 'GET', '/users/list'))
  })
})

summary(() => {
  compact(() => {
    bench('katman: static /api/v1/health', () => katmanFind(kr, 'GET', '/api/v1/health'))
    bench('rou3:   static /api/v1/health', () => rou3Find(rr, 'GET', '/api/v1/health'))
  })
})

// ═══════════════════════════════════════════════════
//  Parametric route lookup
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('katman: param /users/123', () => katmanFind(kr, 'GET', '/users/123'))
    bench('rou3:   param /users/123', () => rou3Find(rr, 'GET', '/users/123'))
  })
})

summary(() => {
  compact(() => {
    bench('katman: param /users/1/posts/2', () => katmanFind(kr, 'GET', '/users/1/posts/2'))
    bench('rou3:   param /users/1/posts/2', () => rou3Find(rr, 'GET', '/users/1/posts/2'))
  })
})

// ═══════════════════════════════════════════════════
//  Wildcard route lookup
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('katman: wildcard /files/a/b/c', () => katmanFind(kr, 'GET', '/files/a/b/c'))
    bench('rou3:   wildcard /files/a/b/c', () => rou3Find(rr, 'GET', '/files/a/b/c'))
  })
})

// ═══════════════════════════════════════════════════
//  Not found
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('katman: not found /missing/deep/path', () => katmanFind(kr, 'GET', '/missing/deep/path'))
    bench('rou3:   not found /missing/deep/path', () => rou3Find(rr, 'GET', '/missing/deep/path'))
  })
})

await run()
