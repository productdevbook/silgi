/**
 * Prototype: Zero-split compiled router techniques.
 *
 * p.split("/") costs 18ns. Everything else is sub-1ns.
 * Replace split() with indexOf() chains to find segment boundaries
 * without allocating arrays or substring objects.
 *
 * Run: node --experimental-strip-types bench/zero-split-proto.ts
 */

import { bench, run, summary, compact } from 'mitata'

// ─── Setup ───────────────────────────────────────────
const path = '/users/123'
const deepPath = '/users/1/posts/2'
const wildcardPath = '/files/a/b/c'
const data = { handler: true }

// Pre-allocated result objects (what the compiled router does)
const _r = { data: null as any, params: null as any }
const _p0 = { id: '' }
const _p1 = { id: '', postId: '' }
const _p2 = { _: '' }

// ═══════════════════════════════════════════════════════
// TECHNIQUE 1: Pure indexOf chain (no split, no startsWith)
// ═══════════════════════════════════════════════════════

function technique1_indexOf(p: string) {
  if (p.charCodeAt(1) === 117 &&  // u
      p.charCodeAt(2) === 115 &&  // s
      p.charCodeAt(3) === 101 &&  // e
      p.charCodeAt(4) === 114 &&  // r
      p.charCodeAt(5) === 115 &&  // s
      p.charCodeAt(6) === 47) {   // /
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
  }
}

// ═══════════════════════════════════════════════════════
// TECHNIQUE 2: Length-gated indexOf
// ═══════════════════════════════════════════════════════

function technique2_lengthGated(p: string) {
  const len = p.length
  if (len >= 8 && p.charCodeAt(6) === 47) {
    if (p.charCodeAt(1) === 117 &&
        p.charCodeAt(2) === 115 &&
        p.charCodeAt(3) === 101 &&
        p.charCodeAt(4) === 114 &&
        p.charCodeAt(5) === 115) {
      if (p.indexOf('/', 7) === -1) {
        _p0.id = p.slice(7)
        _r.data = data; _r.params = _p0; return _r
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// TECHNIQUE 3: Offset-only (defer slice entirely)
// ═══════════════════════════════════════════════════════

const _r2 = { data: null as any, params: null as any }
const _off = { _path: '', _s0: 0, _e0: 0 }
Object.defineProperty(_off, 'id', {
  get() { return this._path.slice(this._s0, this._e0 === -1 ? undefined : this._e0) },
  enumerable: true,
  configurable: false,
})

function technique3_offsetOnly(p: string) {
  if (p.charCodeAt(1) === 117 &&
      p.charCodeAt(2) === 115 &&
      p.charCodeAt(3) === 101 &&
      p.charCodeAt(4) === 114 &&
      p.charCodeAt(5) === 115 &&
      p.charCodeAt(6) === 47) {
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _off._path = p; _off._s0 = 7; _off._e0 = -1
      _r2.data = data; _r2.params = _off; return _r2
    }
  }
}

// ═══════════════════════════════════════════════════════
// TECHNIQUE 4: Packed 32-bit compare
// ═══════════════════════════════════════════════════════

const USER_HASH = (117 << 24 | 115 << 16 | 101 << 8 | 114) >>> 0

function technique4_packed32(p: string) {
  const h = (p.charCodeAt(1) << 24 | p.charCodeAt(2) << 16 | p.charCodeAt(3) << 8 | p.charCodeAt(4)) >>> 0
  if (h === USER_HASH && p.charCodeAt(5) === 115 && p.charCodeAt(6) === 47) {
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
  }
}

// ═══════════════════════════════════════════════════════
// TECHNIQUE 5: Deep param indexOf chain
// ═══════════════════════════════════════════════════════

function technique5_deepParam(p: string) {
  if (p.charCodeAt(1) === 117 &&
      p.charCodeAt(2) === 115 &&
      p.charCodeAt(3) === 101 &&
      p.charCodeAt(4) === 114 &&
      p.charCodeAt(5) === 115 &&
      p.charCodeAt(6) === 47) {
    const s1 = p.indexOf('/', 7)
    if (s1 === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
    if (p.charCodeAt(s1 + 1) === 112 && // p
        p.charCodeAt(s1 + 2) === 111 && // o
        p.charCodeAt(s1 + 3) === 115 && // s
        p.charCodeAt(s1 + 4) === 116 && // t
        p.charCodeAt(s1 + 5) === 115 && // s
        p.charCodeAt(s1 + 6) === 47) {  // /
      const s2 = p.indexOf('/', s1 + 7)
      if (s2 === -1) {
        _p1.id = p.slice(7, s1)
        _p1.postId = p.slice(s1 + 7)
        _r.data = data; _r.params = _p1; return _r
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// TECHNIQUE 6: Offset-only deep param
// ═══════════════════════════════════════════════════════

const _off2 = { _path: '', _s0: 0, _e0: 0, _s1: 0, _e1: 0 }
Object.defineProperty(_off2, 'id', {
  get() { return this._path.slice(this._s0, this._e0) },
  enumerable: true,
})
Object.defineProperty(_off2, 'postId', {
  get() { return this._path.slice(this._s1, this._e1 === -1 ? undefined : this._e1) },
  enumerable: true,
})

function technique6_deepOffset(p: string) {
  if (p.charCodeAt(1) === 117 &&
      p.charCodeAt(2) === 115 &&
      p.charCodeAt(3) === 101 &&
      p.charCodeAt(4) === 114 &&
      p.charCodeAt(5) === 115 &&
      p.charCodeAt(6) === 47) {
    const s1 = p.indexOf('/', 7)
    if (s1 === -1) {
      _off._path = p; _off._s0 = 7; _off._e0 = -1
      _r2.data = data; _r2.params = _off; return _r2
    }
    if (p.charCodeAt(s1 + 1) === 112 &&
        p.charCodeAt(s1 + 2) === 111 &&
        p.charCodeAt(s1 + 3) === 115 &&
        p.charCodeAt(s1 + 4) === 116 &&
        p.charCodeAt(s1 + 5) === 115 &&
        p.charCodeAt(s1 + 6) === 47) {
      const s2 = p.indexOf('/', s1 + 7)
      if (s2 === -1) {
        _off2._path = p; _off2._s0 = 7; _off2._e0 = s1; _off2._s1 = s1 + 7; _off2._e1 = -1
        _r2.data = data; _r2.params = _off2; return _r2
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// TECHNIQUE 7: Wildcard
// ═══════════════════════════════════════════════════════

function technique7_wildcard(p: string) {
  if (p.charCodeAt(1) === 102 &&
      p.charCodeAt(2) === 105 &&
      p.charCodeAt(3) === 108 &&
      p.charCodeAt(4) === 101 &&
      p.charCodeAt(5) === 115 &&
      p.charCodeAt(6) === 47) {
    _p2._ = p.length >= 7 ? p.slice(7) : ''
    _r.data = data; _r.params = _p2; return _r
  }
}

// ═══════════════════════════════════════════════════════
// BASELINE: Current split-based
// ═══════════════════════════════════════════════════════

function currentSplitBased(p: string) {
  if (p.charCodeAt(1) === 117) {
    var s = p.split('/')
    var l = s.length
    if (s[1] === 'users') {
      if (l === 3) {
        _p0.id = s[2]!
        _r.data = data; _r.params = _p0; return _r
      }
    }
  }
}

function currentSplitDeep(p: string) {
  if (p.charCodeAt(1) === 117) {
    var s = p.split('/')
    var l = s.length
    if (s[1] === 'users') {
      if (l === 3) {
        _p0.id = s[2]!
        _r.data = data; _r.params = _p0; return _r
      }
      if (s[3] === 'posts' && l === 5) {
        _p1.id = s[2]!
        _p1.postId = s[4]!
        _r.data = data; _r.params = _p1; return _r
      }
    }
  }
}

// ═══════════════════════════════════════════════════════
// BENCHMARKS
// ═══════════════════════════════════════════════════════

console.log('=== VERIFY CORRECTNESS ===')
console.log('T1 /users/123:', technique1_indexOf('/users/123')?.params)
console.log('T3 /users/456:', technique3_offsetOnly('/users/456')?.params?.id)
console.log('T5 /users/1/posts/2:', technique5_deepParam('/users/1/posts/2')?.params)
console.log('T6 /users/1/posts/2:', technique6_deepOffset('/users/1/posts/2')?.params?.id, technique6_deepOffset('/users/1/posts/2')?.params?.postId)
console.log('T7 /files/a/b/c:', technique7_wildcard('/files/a/b/c')?.params)
console.log('T1 miss:', technique1_indexOf('/posts/123'))
console.log()

console.log('=== SINGLE PARAM: /users/123 ===')
console.log()

summary(() => {
  compact(() => {
    bench('current: split-based', () => currentSplitBased(path))
    bench('T1: indexOf chain + charCodeAt', () => technique1_indexOf(path))
    bench('T2: length-gated indexOf', () => technique2_lengthGated(path))
    bench('T3: offset-only (lazy params)', () => technique3_offsetOnly(path))
    bench('T4: packed 32-bit compare', () => technique4_packed32(path))
  })
})

console.log()
console.log('=== DEEP PARAM: /users/1/posts/2 ===')
console.log()

summary(() => {
  compact(() => {
    bench('current: split deep', () => currentSplitDeep(deepPath))
    bench('T5: indexOf chain deep', () => technique5_deepParam(deepPath))
    bench('T6: offset-only deep', () => technique6_deepOffset(deepPath))
  })
})

console.log()
console.log('=== WILDCARD: /files/a/b/c ===')
console.log()

summary(() => {
  compact(() => {
    bench('T7: charCodeAt + slice', () => technique7_wildcard(wildcardPath))
  })
})

await run()
