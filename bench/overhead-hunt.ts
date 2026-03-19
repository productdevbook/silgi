/**
 * Overhead hunt — where is the extra 12ns going?
 *
 * Run: node --experimental-strip-types bench/overhead-hunt.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123'
const data = { handler: true }

// Warmup helper
function warm(fn: Function, n = 10000) {
  for (let i = 0; i < n; i++) fn('GET', path)
}

// ── Layer 1: bare minimum ───────────────────────────
const _r1 = { data: null as any, params: null as any }
const _p1 = { _p: '', _o: new Int32Array(2), get id() { return this._p.slice(this._o[0], this._o[1]) } }

const bare = (m: string, p: string) => {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1) {
    _p1._p = p; _p1._o[0] = 7; _p1._o[1] = p.length
    _r1.data = data; _r1.params = _p1; return _r1
  }
}

// ── Layer 2: + trailing slash normalize ──────────────
const _r2 = { data: null as any, params: null as any }
const _p2 = { _p: '', _o: new Int32Array(2), get id() { return this._p.slice(this._o[0], this._o[1]) } }

const withNormalize = (m: string, p: string) => {
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1)
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1) {
    _p2._p = p; _p2._o[0] = 7; _p2._o[1] = p.length
    _r2.data = data; _r2.params = _p2; return _r2
  }
}

// ── Layer 3: + switch (always miss) ─────────────────
const _r3 = { data: null as any, params: null as any }
const _p3 = { _p: '', _o: new Int32Array(2), get id() { return this._p.slice(this._o[0], this._o[1]) } }

const withSwitch = (m: string, p: string) => {
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1)
  switch (p) {
    case '/users': return null
    case '/users/list': return null
  }
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1) {
    _p3._p = p; _p3._o[0] = 7; _p3._o[1] = p.length
    _r3.data = data; _r3.params = _p3; return _r3
  }
}

// ── Layer 4: + method check ─────────────────────────
const _r4 = { data: null as any, params: null as any }
const _p4 = { _p: '', _o: new Int32Array(2), get id() { return this._p.slice(this._o[0], this._o[1]) } }

const withMethod = (m: string, p: string) => {
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1)
  switch (p) {
    case '/users': return null
    case '/users/list': return null
  }
  if (p.charCodeAt(1) === 117 && m === 'GET' && p.indexOf('/', 7) === -1) {
    _p4._p = p; _p4._o[0] = 7; _p4._o[1] = p.length
    _r4.data = data; _r4.params = _p4; return _r4
  }
}

// ── Layer 5: + second charCodeAt (boundary check) ───
const _r5 = { data: null as any, params: null as any }
const _p5 = { _p: '', _o: new Int32Array(2), get id() { return this._p.slice(this._o[0], this._o[1]) } }

const withBoundary = (m: string, p: string) => {
  if (p.length > 1 && p.charCodeAt(p.length - 1) === 47) p = p.slice(0, -1)
  switch (p) {
    case '/users': return null
    case '/users/list': return null
  }
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47 && m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
    _p5._p = p; _p5._o[0] = 7; _p5._o[1] = p.length
    _r5.data = data; _r5.params = _p5; return _r5
  }
}

// Warmup all
warm(bare); warm(withNormalize); warm(withSwitch); warm(withMethod); warm(withBoundary)

console.log('bare:', bare('GET', path)?.data === data)
console.log('withBoundary:', withBoundary('GET', path)?.data === data)
console.log()

summary(() => {
  compact(() => {
    bench('L1: bare (charCodeAt + indexOf + offset)', () => bare('GET', path))
    bench('L2: + normalize', () => withNormalize('GET', path))
    bench('L3: + switch (miss)', () => withSwitch('GET', path))
    bench('L4: + method check', () => withMethod('GET', path))
    bench('L5: + boundary check', () => withBoundary('GET', path))
  })
})

await run()
