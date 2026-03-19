/**
 * Benchmark: Katman RegExpRouter vs rou3 compiled vs Katman compiled
 *
 * Run: node --experimental-strip-types bench/router-regexp.ts
 */

import { bench, run, summary, compact } from 'mitata'

// Katman RegExpRouter
import { RegExpRouter } from '../src/route/regexp.ts'

// Katman radix + compiled
import { createRouter as katmanCreate, addRoute as katmanAdd, findRoute as katmanFind, compileRouter as katmanCompile } from '../src/route/index.ts'

// rou3
import { createRouter as rou3Create, addRoute as rou3Add, findRoute as rou3Find } from 'rou3'
import { compileRouter as rou3Compile } from 'rou3/compiler'

// ── Setup ────────────────────────────────────────────

const paths = [
  '/users', '/users/list', '/posts', '/posts/list',
  '/api/v1/health', '/api/v1/config',
  '/admin/dashboard', '/admin/settings',
  '/users/:id', '/users/:id/posts', '/users/:id/posts/:postId',
  '/api/v1/:resource', '/api/v1/:resource/:id',
  '/files/**', '/assets/**', '/cdn/**:path',
]

// Katman RegExpRouter
const re = new RegExpRouter()
for (const p of paths) re.add('GET', p, { path: p })
// Warmup — first call compiles
re.match('GET', '/users/list')

// Katman radix compiled
const kr = katmanCreate()
for (const p of paths) katmanAdd(kr, 'GET', p, { path: p })
const kc = katmanCompile(kr)

// rou3 compiled
const rr = rou3Create()
for (const p of paths) rou3Add(rr, 'GET', p, { path: p })
const rc = rou3Compile(rr)

// ── Verify correctness ──────────────────────────────

const checks: [string, string, Record<string, string>?][] = [
  ['/users/list', 'static'],
  ['/users/123', 'param', { id: '123' }],
  ['/users/1/posts/2', 'deep param', { id: '1', postId: '2' }],
  ['/files/a/b/c', 'wildcard'],
]

for (const [path, label, expectedParams] of checks) {
  const m = re.match('GET', path)
  if (!m) { console.error(`FAIL regexp: ${label} ${path} = undefined`); continue }
  if (expectedParams) {
    for (const [k, v] of Object.entries(expectedParams)) {
      if (m.params?.[k] !== v) console.error(`FAIL regexp: ${label} ${path} param ${k} = ${m.params?.[k]} (expected ${v})`)
    }
  }
}
console.log('Correctness checks passed\n')

// ═══════════════════════════════════════════════════
//  Static route
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('regexp:   static /users/list', () => re.match('GET', '/users/list'))
    bench('compiled: static /users/list', () => kc('GET', '/users/list'))
    bench('rou3:     static /users/list', () => rc('GET', '/users/list'))
  })
})

// ═══════════════════════════════════════════════════
//  Param route
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('regexp:   param /users/123', () => re.match('GET', '/users/123'))
    bench('compiled: param /users/123', () => kc('GET', '/users/123'))
    bench('rou3:     param /users/123', () => rc('GET', '/users/123'))
  })
})

// ═══════════════════════════════════════════════════
//  Deep param
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('regexp:   deep /users/1/posts/2', () => re.match('GET', '/users/1/posts/2'))
    bench('compiled: deep /users/1/posts/2', () => kc('GET', '/users/1/posts/2'))
    bench('rou3:     deep /users/1/posts/2', () => rc('GET', '/users/1/posts/2'))
  })
})

// ═══════════════════════════════════════════════════
//  Wildcard
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('regexp:   wildcard /files/a/b/c', () => re.match('GET', '/files/a/b/c'))
    bench('compiled: wildcard /files/a/b/c', () => kc('GET', '/files/a/b/c'))
    bench('rou3:     wildcard /files/a/b/c', () => rc('GET', '/files/a/b/c'))
  })
})

// ═══════════════════════════════════════════════════
//  Not found
// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('regexp:   miss /missing/deep', () => re.match('GET', '/missing/deep'))
    bench('compiled: miss /missing/deep', () => kc('GET', '/missing/deep'))
    bench('rou3:     miss /missing/deep', () => rc('GET', '/missing/deep'))
  })
})

await run()
