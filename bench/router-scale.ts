/**
 * Benchmark: Scale test — 100+ routes
 *
 * Run: node --experimental-strip-types bench/router-scale.ts
 */

import { bench, run, summary, compact } from 'mitata'
import { RegExpRouter } from '../src/route/regexp.ts'
import { createRouter as katmanCreate, addRoute as katmanAdd, compileRouter as katmanCompile } from '../src/route/index.ts'
import { createRouter as rou3Create, addRoute as rou3Add } from 'rou3'
import { compileRouter as rou3Compile } from 'rou3/compiler'

// ── Generate 200 routes (GitHub API-like) ───────────

const routes: string[] = []
const resources = ['users', 'repos', 'orgs', 'teams', 'projects', 'gists', 'issues', 'pulls', 'commits', 'branches']
for (const r of resources) {
  routes.push(`/${r}`)
  routes.push(`/${r}/list`)
  routes.push(`/${r}/:id`)
  routes.push(`/${r}/:id/details`)
  routes.push(`/${r}/:id/edit`)
  routes.push(`/${r}/:id/delete`)
  routes.push(`/${r}/:id/comments`)
  routes.push(`/${r}/:id/comments/:commentId`)
  routes.push(`/${r}/:id/labels`)
  routes.push(`/${r}/:id/labels/:labelId`)
  routes.push(`/api/v1/${r}`)
  routes.push(`/api/v1/${r}/:id`)
  routes.push(`/api/v2/${r}`)
  routes.push(`/api/v2/${r}/:id`)
  routes.push(`/admin/${r}`)
  routes.push(`/admin/${r}/:id`)
  routes.push(`/admin/${r}/:id/audit`)
  routes.push(`/internal/${r}/**`)
}

console.log(`Total routes: ${routes.length}`)

// Setup
const re = new RegExpRouter()
const kr = katmanCreate()
const rr = rou3Create()

for (const p of routes) {
  re.add('GET', p, { path: p })
  katmanAdd(kr, 'GET', p, { path: p })
  rou3Add(rr, 'GET', p, { path: p })
}

re.match('GET', '/users') // warmup
const kc = katmanCompile(kr)
const rc = rou3Compile(rr)

// Verify
const testPath = '/repos/123/comments/456'
const m1 = re.match('GET', testPath)
const m2 = kc('GET', testPath)
const m3 = rc('GET', testPath)
console.log('regexp:', m1?.data, m1?.params)
console.log('compiled:', m2?.data, m2?.params)
console.log('rou3:', m3?.data, m3?.params)
console.log()

// ═══════════════════════════════════════════════════

summary(() => {
  compact(() => {
    bench('regexp:   static /users/list (200 routes)', () => re.match('GET', '/users/list'))
    bench('compiled: static /users/list (200 routes)', () => kc('GET', '/users/list'))
    bench('rou3:     static /users/list (200 routes)', () => rc('GET', '/users/list'))
  })
})

summary(() => {
  compact(() => {
    bench('regexp:   param (200 routes)', () => re.match('GET', '/repos/123'))
    bench('compiled: param (200 routes)', () => kc('GET', '/repos/123'))
    bench('rou3:     param (200 routes)', () => rc('GET', '/repos/123'))
  })
})

summary(() => {
  compact(() => {
    bench('regexp:   deep param (200 routes)', () => re.match('GET', '/repos/123/comments/456'))
    bench('compiled: deep param (200 routes)', () => kc('GET', '/repos/123/comments/456'))
    bench('rou3:     deep param (200 routes)', () => rc('GET', '/repos/123/comments/456'))
  })
})

summary(() => {
  compact(() => {
    bench('regexp:   last resource (200 routes)', () => re.match('GET', '/branches/99/labels/5'))
    bench('compiled: last resource (200 routes)', () => kc('GET', '/branches/99/labels/5'))
    bench('rou3:     last resource (200 routes)', () => rc('GET', '/branches/99/labels/5'))
  })
})

summary(() => {
  compact(() => {
    bench('regexp:   wildcard (200 routes)', () => re.match('GET', '/internal/users/some/deep/path'))
    bench('compiled: wildcard (200 routes)', () => kc('GET', '/internal/users/some/deep/path'))
    bench('rou3:     wildcard (200 routes)', () => rc('GET', '/internal/users/some/deep/path'))
  })
})

summary(() => {
  compact(() => {
    bench('regexp:   miss (200 routes)', () => re.match('GET', '/nonexistent/deep/path'))
    bench('compiled: miss (200 routes)', () => kc('GET', '/nonexistent/deep/path'))
    bench('rou3:     miss (200 routes)', () => rc('GET', '/nonexistent/deep/path'))
  })
})

await run()
