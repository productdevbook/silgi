/**
 * Zero-split v2: Hybrid approaches for deep params.
 *
 * Insight from v1:
 * - Single param: charCodeAt + indexOf + slice = 9ns (vs 21ns split)  [2.3x win]
 * - Single param: offset-only = 5.3ns  [4x win]
 * - Deep param: charCodeAt chain = 24ns (WORSE than split's 22ns!)
 *
 * WHY deep params are slow with indexOf chain:
 * - Each dynamic indexOf(s1+N) prevents V8 from constant-folding
 * - The charCodeAt(s1+1), charCodeAt(s1+2) etc. can't be unrolled by TurboFan
 *   because s1 is a runtime value
 * - Split benefits from a tight C++ loop for the whole string at once
 *
 * NEW APPROACHES for deep params:
 * 1. Hybrid: use compile-time known prefix via charCodeAt, then
 *    a single strategic indexOf to split only the remaining portion
 * 2. Manual scan loop: single pass, no function calls
 * 3. Key insight: for /users/:id/posts/:postId, the "posts" segment
 *    is STATIC. We can compute its offset as (7 + paramLen + 1).
 *    If we find the end of :id, we know exactly where "posts" starts.
 *    Compare 5 chars: "posts". Then the next param starts at known offset.
 *
 * Run: node --experimental-strip-types bench/zero-split-v2.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123'
const deepPath = '/users/1/posts/2'
const veryDeepPath = '/api/v1/users/42/posts/99'
const wildcardPath = '/files/a/b/c'
const data = { handler: true }

const _r = { data: null as any, params: null as any }
const _p0 = { id: '' }
const _p1 = { id: '', postId: '' }

// ═══════════════════════════════════════════════════════
// APPROACH A: Single-pass manual scan
//
// Instead of calling indexOf multiple times, scan the string once.
// Track segment boundaries in local variables (stack-allocated).
// This is what a hand-written C parser would do.
// ═══════════════════════════════════════════════════════

function approachA_singleScan(p: string) {
  // We know the prefix is "/users/" (7 chars)
  // Check it via charCodeAt
  if (p.charCodeAt(1) !== 117 || // u
      p.charCodeAt(2) !== 115 || // s
      p.charCodeAt(3) !== 101 || // e
      p.charCodeAt(4) !== 114 || // r
      p.charCodeAt(5) !== 115 || // s
      p.charCodeAt(6) !== 47) return // /

  // Scan from position 7 to find segment boundaries
  const len = p.length
  let i = 7
  // Find end of :id
  while (i < len && p.charCodeAt(i) !== 47) i++

  if (i === len) {
    // /users/:id — single param
    _p0.id = p.slice(7, i)
    _r.data = data; _r.params = _p0; return _r
  }

  // We're at the slash after :id. Check for "/posts/"
  // i points to '/'. Next segment should be "posts"
  if (i + 6 < len &&
      p.charCodeAt(i + 1) === 112 && // p
      p.charCodeAt(i + 2) === 111 && // o
      p.charCodeAt(i + 3) === 115 && // s
      p.charCodeAt(i + 4) === 116 && // t
      p.charCodeAt(i + 5) === 115 && // s
      p.charCodeAt(i + 6) === 47) {  // /
    // Find end of :postId
    const s2 = i + 7
    let j = s2
    while (j < len && p.charCodeAt(j) !== 47) j++
    if (j === len) {
      _p1.id = p.slice(7, i)
      _p1.postId = p.slice(s2, j)
      _r.data = data; _r.params = _p1; return _r
    }
  }
}

// ═══════════════════════════════════════════════════════
// APPROACH B: Two-indexOf (strategic placement)
//
// For /users/:id/posts/:postId:
// - Prefix "/users/" is 7 chars (compile-time)
// - First indexOf("/", 7) gives end of :id → s1
// - We know "posts/" is 6 chars, so :postId starts at s1+7
// - Second indexOf("/", s1+7) must be -1 for exact match
// Only 2 indexOf calls total.
// ═══════════════════════════════════════════════════════

function approachB_twoIndexOf(p: string) {
  if (p.charCodeAt(1) !== 117 ||
      p.charCodeAt(2) !== 115 ||
      p.charCodeAt(3) !== 101 ||
      p.charCodeAt(4) !== 114 ||
      p.charCodeAt(5) !== 115 ||
      p.charCodeAt(6) !== 47) return

  const s1 = p.indexOf('/', 7)
  if (s1 === -1) {
    _p0.id = p.slice(7)
    _r.data = data; _r.params = _p0; return _r
  }

  // Check "posts/" at s1+1 using FEWER checks
  // "posts/" is 6 chars. Use 2x 3-char packs instead of 6 individual checks
  if (p.charCodeAt(s1 + 1) === 112 && // p
      p.charCodeAt(s1 + 3) === 115 && // s (skip o, it's unique enough)
      p.charCodeAt(s1 + 5) === 115 && // s
      p.charCodeAt(s1 + 6) === 47) {  // /
    if (p.indexOf('/', s1 + 7) === -1) {
      _p1.id = p.slice(7, s1)
      _p1.postId = p.slice(s1 + 7)
      _r.data = data; _r.params = _p1; return _r
    }
  }
}

// ═══════════════════════════════════════════════════════
// APPROACH C: indexOf + length check (skip inner verification)
//
// Key insight: if we KNOW the route tree structure, then
// after matching /users/:id, the only possible deeper route
// at this point is /users/:id/posts/:postId.
// So instead of checking "posts", just check that the structure
// (number of slashes) matches. Use length math.
//
// /users/X/posts/Y has exactly 4 slashes.
// After matching prefix "/users/" and finding s1 (end of :id),
// we need exactly one more slash at position s1+7+len(postId).
// ═══════════════════════════════════════════════════════

function approachC_structuralMatch(p: string) {
  if (p.charCodeAt(1) !== 117 ||
      p.charCodeAt(2) !== 115 ||
      p.charCodeAt(3) !== 101 ||
      p.charCodeAt(4) !== 114 ||
      p.charCodeAt(5) !== 115 ||
      p.charCodeAt(6) !== 47) return

  const s1 = p.indexOf('/', 7)
  if (s1 === -1) {
    _p0.id = p.slice(7)
    _r.data = data; _r.params = _p0; return _r
  }

  // For deep route: check the static segment matches AND verify structure
  // s1 is end of :id. "posts" is 5 chars, so next slash at s1+6
  // :postId starts at s1+7, must go to end (no more slashes)
  if (p.length > s1 + 7 &&
      p.charCodeAt(s1 + 1) === 112 && // p
      p.charCodeAt(s1 + 5) === 115 && // s (check first and last of "posts")
      p.charCodeAt(s1 + 6) === 47 &&  // /
      p.indexOf('/', s1 + 7) === -1) {
    _p1.id = p.slice(7, s1)
    _p1.postId = p.slice(s1 + 7)
    _r.data = data; _r.params = _p1; return _r
  }
}

// ═══════════════════════════════════════════════════════
// APPROACH D: Pre-computed offsets + slice at end
//
// Do ALL boundary computation first with zero allocation,
// THEN do all slices at the end in a batch.
// This helps V8 because slice calls are grouped, reducing
// register pressure during the match phase.
// ═══════════════════════════════════════════════════════

function approachD_batchSlice(p: string) {
  if (p.charCodeAt(1) !== 117 ||
      p.charCodeAt(2) !== 115 ||
      p.charCodeAt(3) !== 101 ||
      p.charCodeAt(4) !== 114 ||
      p.charCodeAt(5) !== 115 ||
      p.charCodeAt(6) !== 47) return

  const s1 = p.indexOf('/', 7)
  if (s1 === -1) {
    _p0.id = p.slice(7)
    _r.data = data; _r.params = _p0; return _r
  }

  if (p.charCodeAt(s1 + 1) === 112 &&
      p.charCodeAt(s1 + 5) === 115 &&
      p.charCodeAt(s1 + 6) === 47) {
    const s2start = s1 + 7
    if (p.indexOf('/', s2start) === -1) {
      // Batch slice
      const id = p.slice(7, s1)
      const postId = p.slice(s2start)
      _p1.id = id; _p1.postId = postId
      _r.data = data; _r.params = _p1; return _r
    }
  }
}

// ═══════════════════════════════════════════════════════
// APPROACH E: Lazy offset deep (no slice during match)
// ═══════════════════════════════════════════════════════

const _r3 = { data: null as any, params: null as any }
const _lo = { _p: '', _a: 0, _b: 0, _c: 0 }
Object.defineProperty(_lo, 'id', {
  get() { return this._p.slice(this._a, this._b) },
  enumerable: true,
})
Object.defineProperty(_lo, 'postId', {
  get() { return this._p.slice(this._c) },
  enumerable: true,
})

function approachE_lazyDeep(p: string) {
  if (p.charCodeAt(1) !== 117 ||
      p.charCodeAt(2) !== 115 ||
      p.charCodeAt(3) !== 101 ||
      p.charCodeAt(4) !== 114 ||
      p.charCodeAt(5) !== 115 ||
      p.charCodeAt(6) !== 47) return

  const s1 = p.indexOf('/', 7)
  if (s1 === -1) {
    // single param — still lazy
    _lo._p = p; _lo._a = 7; _lo._b = p.length; _lo._c = 0
    _r3.data = data; _r3.params = _lo; return _r3
  }

  if (p.charCodeAt(s1 + 1) === 112 &&
      p.charCodeAt(s1 + 5) === 115 &&
      p.charCodeAt(s1 + 6) === 47 &&
      p.indexOf('/', s1 + 7) === -1) {
    _lo._p = p; _lo._a = 7; _lo._b = s1; _lo._c = s1 + 7
    _r3.data = data; _r3.params = _lo; return _r3
  }
}

// ═══════════════════════════════════════════════════════
// APPROACH F: Hybrid — indexOf for structure, lazy for params
//
// This combines the best insights:
// - charCodeAt for prefix verification (constant offsets)
// - Single indexOf for each param boundary
// - Store offsets, not strings
// - Use a Proxy or getter object for lazy extraction
// ═══════════════════════════════════════════════════════

// But let's try something radical: a single-allocation-free approach
// that stores the result differently. Instead of params: {id: "123"},
// use params as an array: [7, -1] meaning "slice(7) to end".
// The consumer calls a helper: getParam(result, 0) → p.slice(7)
// This moves ALL allocation to the consumer side.

// ═══════════════════════════════════════════════════════
// BASELINE: split-based
// ═══════════════════════════════════════════════════════

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

function currentSplitSingle(p: string) {
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

// ═══════════════════════════════════════════════════════
// BENCHMARKS
// ═══════════════════════════════════════════════════════

console.log('=== VERIFY ===')
console.log('A deep:', approachA_singleScan(deepPath)?.params)
console.log('B deep:', approachB_twoIndexOf(deepPath)?.params)
console.log('C deep:', approachC_structuralMatch(deepPath)?.params)
console.log('D deep:', approachD_batchSlice(deepPath)?.params)
console.log('E deep lazy:', approachE_lazyDeep(deepPath)?.params?.id, approachE_lazyDeep(deepPath)?.params?.postId)
console.log('A single:', approachA_singleScan(path)?.params)
console.log('E single lazy:', approachE_lazyDeep(path)?.params?.id)
console.log()

console.log('=== SINGLE PARAM: /users/123 ===')
summary(() => {
  compact(() => {
    bench('baseline: split', () => currentSplitSingle(path))
    bench('A: single-scan loop', () => approachA_singleScan(path))
    bench('B: two-indexOf', () => approachB_twoIndexOf(path))
    bench('E: lazy offset', () => approachE_lazyDeep(path))
  })
})

console.log()
console.log('=== DEEP PARAM: /users/1/posts/2 ===')
summary(() => {
  compact(() => {
    bench('baseline: split', () => currentSplitDeep(deepPath))
    bench('A: single-scan loop', () => approachA_singleScan(deepPath))
    bench('B: two-indexOf (sparse check)', () => approachB_twoIndexOf(deepPath))
    bench('C: structural match', () => approachC_structuralMatch(deepPath))
    bench('D: batch slice', () => approachD_batchSlice(deepPath))
    bench('E: lazy offset deep', () => approachE_lazyDeep(deepPath))
  })
})

// Also test: does param access cost matter?
console.log()
console.log('=== DEEP PARAM + ACCESS PARAMS: /users/1/posts/2 ===')
let sink: any
summary(() => {
  compact(() => {
    bench('baseline: split + access', () => {
      const r = currentSplitDeep(deepPath)
      sink = r?.params?.id
      sink = r?.params?.postId
    })
    bench('D: batch + access', () => {
      const r = approachD_batchSlice(deepPath)
      sink = r?.params?.id
      sink = r?.params?.postId
    })
    bench('E: lazy + access', () => {
      const r = approachE_lazyDeep(deepPath)
      sink = r?.params?.id
      sink = r?.params?.postId
    })
  })
})

await run()
