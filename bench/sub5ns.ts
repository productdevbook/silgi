/**
 * Sub-5ns experiments — finding the fastest param matching pattern.
 *
 * Run: node --experimental-strip-types bench/sub5ns.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123'
const deepPath = '/users/1/posts/2'

// Pre-computed constants
const data = { handler: true }
const _r = { data: null as any, params: null as any }
const _p = { id: '' }
const _p2 = { id: '', postId: '' }

// ── Experiment 1: Eliminate ALL string ops — use length-based dispatch ──
// Key insight: for RPC, route paths are predictable. We can dispatch on length alone.
// /users/X = length 8-20 (7 + param length)
// /posts/X = length 8-20 (7 + param length)

function exp1_lengthDispatch(p: string) {
  const len = p.length
  // /users/:id → starts at 7, ends at len
  if (len > 7 && p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47) {
    // Quick 2-char check: 'u' at 1, '/' at 6
    _p.id = p.slice(7)
    _r.data = data; _r.params = _p; return _r
  }
}

// ── Experiment 2: Direct charCodeAt comparison (no startsWith) ──
function exp2_charCodes(p: string) {
  if (p.charCodeAt(1) === 117 && // u
      p.charCodeAt(2) === 115 && // s
      p.charCodeAt(3) === 101 && // e
      p.charCodeAt(4) === 114 && // r
      p.charCodeAt(5) === 115 && // s
      p.charCodeAt(6) === 47) {  // /
    if (p.indexOf('/', 7) === -1) {
      _p.id = p.slice(7)
      _r.data = data; _r.params = _p; return _r
    }
  }
}

// ── Experiment 3: Two-char + length dispatch (fastest reject) ──
function exp3_twoChar(p: string) {
  // Unique 2-char signature: char[1] + char[length-1] + length range
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47 && p.length > 7 && p.indexOf('/', 7) === -1) {
    _p.id = p.slice(7)
    _r.data = data; _r.params = _p; return _r
  }
}

// ── Experiment 4: Pre-compute 32-bit hash from first 4 chars ──
function hash4(p: string): number {
  return (p.charCodeAt(1) << 24) | (p.charCodeAt(2) << 16) | (p.charCodeAt(3) << 8) | p.charCodeAt(4)
}
const USERS_HASH = hash4('/users/')  // pre-computed

function exp4_hash(p: string) {
  const h = (p.charCodeAt(1) << 24) | (p.charCodeAt(2) << 16) | (p.charCodeAt(3) << 8) | p.charCodeAt(4)
  if (h === USERS_HASH && p.charCodeAt(5) === 115 && p.charCodeAt(6) === 47 && p.indexOf('/', 7) === -1) {
    _p.id = p.slice(7)
    _r.data = data; _r.params = _p; return _r
  }
}

// ── Experiment 5: Offset-only (no slice at all) ──
const _rOffset = { data: null as any, paramStart: 0, paramEnd: 0, path: '' }

function exp5_offsetOnly(p: string) {
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47 && p.length > 7 && p.indexOf('/', 7) === -1) {
    _rOffset.data = data; _rOffset.path = p; _rOffset.paramStart = 7; _rOffset.paramEnd = p.length
    return _rOffset
  }
}

// ── Experiment 6: Substring (V8 SlicedString for len >= 13) ──
function exp6_substring(p: string) {
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47 && p.length > 7 && p.indexOf('/', 7) === -1) {
    _p.id = p.substring(7)
    _r.data = data; _r.params = _p; return _r
  }
}

// ── Experiment 7: Deep param — /users/:id/posts/:postId ──
function exp7_deep_split(p: string) {
  const s = p.split('/')
  if (s[1] === 'users' && s[3] === 'posts' && s.length === 5) {
    _p2.id = s[2]!; _p2.postId = s[4]!
    _r.data = data; _r.params = _p2; return _r
  }
}

function exp7_deep_indexOf(p: string) {
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47) {
    const i1 = p.indexOf('/', 7)
    if (i1 !== -1 && p.charCodeAt(i1 + 1) === 112 && p.charCodeAt(i1 + 6) === 47) {
      const i2 = p.indexOf('/', i1 + 7)
      if (i2 === -1) {
        _p2.id = p.slice(7, i1)
        _p2.postId = p.slice(i1 + 7)
        _r.data = data; _r.params = _p2; return _r
      }
    }
  }
}

function exp7_deep_offsetOnly(p: string) {
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47) {
    const i1 = p.indexOf('/', 7)
    if (i1 !== -1 && p.charCodeAt(i1 + 1) === 112 && p.charCodeAt(i1 + 6) === 47) {
      if (p.indexOf('/', i1 + 7) === -1) {
        _rOffset.data = data; _rOffset.path = p
        _rOffset.paramStart = 7; _rOffset.paramEnd = i1
        return _rOffset
      }
    }
  }
}

// ── Verify correctness ──
console.log('exp1:', exp1_lengthDispatch(path))
console.log('exp2:', exp2_charCodes(path))
console.log('exp3:', exp3_twoChar(path))
console.log('exp4:', exp4_hash(path))
console.log('exp5:', exp5_offsetOnly(path))
console.log('exp6:', exp6_substring(path))
console.log('deep_split:', exp7_deep_split(deepPath))
console.log('deep_indexOf:', exp7_deep_indexOf(deepPath))
console.log('deep_offset:', exp7_deep_offsetOnly(deepPath))
console.log()

// ── Single param benchmarks ──
summary(() => {
  compact(() => {
    bench('exp1: length dispatch', () => exp1_lengthDispatch(path))
    bench('exp2: charCodes x6', () => exp2_charCodes(path))
    bench('exp3: two-char + length', () => exp3_twoChar(path))
    bench('exp4: 4-char hash', () => exp4_hash(path))
    bench('exp5: offset only (no slice)', () => exp5_offsetOnly(path))
    bench('exp6: substring', () => exp6_substring(path))
  })
})

// ── Deep param benchmarks ──
summary(() => {
  compact(() => {
    bench('deep: split-based', () => exp7_deep_split(deepPath))
    bench('deep: indexOf chain', () => exp7_deep_indexOf(deepPath))
    bench('deep: offset only', () => exp7_deep_offsetOnly(deepPath))
  })
})

await run()
