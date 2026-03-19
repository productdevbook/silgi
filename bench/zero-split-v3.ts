/**
 * Zero-split v3: Focus on sub-10ns with eager param extraction.
 *
 * Findings so far:
 * - Lazy (offset-only): 5.3ns match, but ~23ns with param access
 * - Eager (charCodeAt + indexOf + slice): 9.2ns single param
 * - Split baseline: 21ns
 *
 * This file explores whether we can get eager extraction under 8ns
 * by minimizing the cost of the charCodeAt prefix check.
 *
 * V8 insight: charCodeAt is <0.1ns per call when the string is a
 * SeqOneByteString (ASCII) and the index is a Smi. But 5-6 chained
 * comparisons with short-circuit && still cost ~3ns total due to
 * branch misprediction overhead.
 *
 * Run: node --experimental-strip-types bench/zero-split-v3.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123'
const deepPath = '/users/1/posts/2'
const data = { handler: true }

const _r = { data: null as any, params: null as any }
const _p0 = { id: '' }
const _p1 = { id: '', postId: '' }

// ═══════════════════════════════════════════════════════
// Q1: How many charCodeAt checks do we ACTUALLY need?
//
// For /users/:id, our dispatch already checked p[1]==='u'.
// The question is: what's the minimum to uniquely identify
// the prefix "/users/" from all other routes?
//
// If the route set has /users/:id and /uploads/:id, both
// start with 'u'. So we need at least p[2] to distinguish.
// But in practice, at the emitRoot level, we already
// partition by first char. Within that partition, we could
// use a DIFFERENT strategy than checking every char.
// ═══════════════════════════════════════════════════════

// Strategy 1: Partial check — only verify 2-3 diagnostic chars
// For "users", checking p[1]='u' p[5]='s' p[6]='/' may be enough
// if no other route prefix matches that pattern.
function partialCheck(p: string) {
  if (p.charCodeAt(1) === 117 && // u
      p.charCodeAt(5) === 115 && // s
      p.charCodeAt(6) === 47) {  // /
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
  }
}

// Strategy 2: Use indexOf of the prefix "/" + segment + "/"
// This is what startsWith does but we know it costs 5ns.
// Can we do better with a computed approach?

// Strategy 3: Pre-compute a hash of the prefix and compare
// Use (charCodeAt(1) * 31 + charCodeAt(2)) as a cheap 2-char hash
function hashCheck(p: string) {
  // 117*31+115 = 3742 for "us"
  const h = p.charCodeAt(1) * 31 + p.charCodeAt(2)
  if (h === 3742 && p.charCodeAt(6) === 47) {
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
  }
}

// Strategy 4: Full charCodeAt (current best eager approach)
function fullCharCodeAt(p: string) {
  if (p.charCodeAt(1) === 117 && // u
      p.charCodeAt(2) === 115 && // s
      p.charCodeAt(3) === 101 && // e
      p.charCodeAt(4) === 114 && // r
      p.charCodeAt(5) === 115 && // s
      p.charCodeAt(6) === 47) {  // /
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
  }
}

// Strategy 5: Use a generated equality function via new Function
// The idea: generate `return p.charCodeAt(1)===117&&p.charCodeAt(2)===115...`
// as a separate function that V8 can inline.
const checkUsersPrefix = new Function('p',
  'return p.charCodeAt(1)===117&&p.charCodeAt(2)===115&&p.charCodeAt(3)===101&&p.charCodeAt(4)===114&&p.charCodeAt(5)===115&&p.charCodeAt(6)===47'
) as (p: string) => boolean

function generatedCheck(p: string) {
  if (checkUsersPrefix(p)) {
    const e = p.indexOf('/', 7)
    if (e === -1) {
      _p0.id = p.slice(7)
      _r.data = data; _r.params = _p0; return _r
    }
  }
}

// Strategy 6: Avoid the inner function call — inline everything
// Generated as one monolithic function via new Function
const monolithic = new Function('data', '_p0', '_r',
  `return function(p) {
    if (p.charCodeAt(1)===117&&p.charCodeAt(2)===115&&p.charCodeAt(3)===101&&p.charCodeAt(4)===114&&p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
      var e=p.indexOf("/",7);
      if (e===-1) {
        _p0.id=p.slice(7);
        _r.data=data;_r.params=_p0;return _r;
      }
    }
  }`
)(data, _p0, _r) as (p: string) => any

// Strategy 7: Use substring comparison for prefix
// p.substring(0, 7) === "/users/" but create the comparison string once
const PREFIX = '/users/'
function substringCheck(p: string) {
  if (p.length >= 8) {
    // V8 might optimize this comparison as it's comparing against an internalized string
    if (p[1] === 'u' && p[6] === '/' && p.substring(1, 6) === 'users') {
      const e = p.indexOf('/', 7)
      if (e === -1) {
        _p0.id = p.slice(7)
        _r.data = data; _r.params = _p0; return _r
      }
    }
  }
}

// Strategy 8: Use the most radical approach — treat the string as
// two 32-bit integers for prefix comparison.
// "/use" = 0x2F757365  and "rs/" = rest
// BUT this requires DataView or similar, which is way too expensive.
// Skip this.

// Strategy 9: new Function that embeds the complete router logic
// including the switch for statics. This is closest to what the
// real compiler would generate.
const fullRouterFn = new Function('data', '_p0', '_p1', '_r',
  `var _r2={data:null,params:null};
  return function(m,p) {
    if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);
    switch(p) {
      case "/users": _r.data=data;_r.params=null;return _r;
      case "/users/list": _r.data=data;_r.params=null;return _r;
    }
    if(p.charCodeAt(1)===117&&p.charCodeAt(2)===115&&p.charCodeAt(3)===101&&p.charCodeAt(4)===114&&p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
      var e=p.indexOf("/",7);
      if(e===-1) {
        _p0.id=p.slice(7);
        _r.data=data;_r.params=_p0;return _r;
      }
      if(p.charCodeAt(e+1)===112&&p.charCodeAt(e+5)===115&&p.charCodeAt(e+6)===47) {
        if(p.indexOf("/",e+7)===-1) {
          _p1.id=p.slice(7,e);
          _p1.postId=p.slice(e+7);
          _r.data=data;_r.params=_p1;return _r;
        }
      }
    }
  }`
)(data, _p0, _p1, _r) as (m: string, p: string) => any

// Strategy 10: What if we use the SAME new Function approach
// but avoid the trailing-slash normalization by requiring the
// caller to pre-normalize? This saves one branch + potential slice.
const noNormFn = new Function('data', '_p0', '_p1', '_r',
  `return function(m,p) {
    switch(p) {
      case "/users": _r.data=data;_r.params=null;return _r;
      case "/users/list": _r.data=data;_r.params=null;return _r;
    }
    if(p.charCodeAt(1)===117&&p.charCodeAt(2)===115&&p.charCodeAt(3)===101&&p.charCodeAt(4)===114&&p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
      var e=p.indexOf("/",7);
      if(e===-1) {
        _p0.id=p.slice(7);
        _r.data=data;_r.params=_p0;return _r;
      }
      if(p.charCodeAt(e+1)===112&&p.charCodeAt(e+5)===115&&p.charCodeAt(e+6)===47) {
        if(p.indexOf("/",e+7)===-1) {
          _p1.id=p.slice(7,e);
          _p1.postId=p.slice(e+7);
          _r.data=data;_r.params=_p1;return _r;
        }
      }
    }
  }`
)(data, _p0, _p1, _r) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// VERIFY
// ═══════════════════════════════════════════════════════
console.log('=== VERIFY ===')
console.log('partial:', partialCheck(path)?.params)
console.log('hash:', hashCheck(path)?.params)
console.log('full:', fullCharCodeAt(path)?.params)
console.log('generated:', generatedCheck(path)?.params)
console.log('monolithic:', monolithic(path)?.params)
console.log('substring:', substringCheck(path)?.params)
console.log('fullRouter single:', fullRouterFn('GET', path)?.params)
console.log('fullRouter deep:', fullRouterFn('GET', deepPath)?.params)
console.log('noNorm single:', noNormFn('GET', path)?.params)
console.log('noNorm deep:', noNormFn('GET', deepPath)?.params)
console.log()

// ═══════════════════════════════════════════════════════
// SINGLE PARAM PREFIX STRATEGIES
// ═══════════════════════════════════════════════════════
console.log('=== SINGLE PARAM: prefix strategies ===')
summary(() => {
  compact(() => {
    bench('full charCodeAt (6 checks)', () => fullCharCodeAt(path))
    bench('partial charCodeAt (3 checks)', () => partialCheck(path))
    bench('hash check', () => hashCheck(path))
    bench('generated check (new Function)', () => generatedCheck(path))
    bench('monolithic (new Function)', () => monolithic(path))
    bench('substring check', () => substringCheck(path))
  })
})

// ═══════════════════════════════════════════════════════
// FULL ROUTER SIMULATION (with switch + param)
// ═══════════════════════════════════════════════════════
console.log()
console.log('=== FULL ROUTER: /users/123 (single param, with switch) ===')
summary(() => {
  compact(() => {
    bench('fullRouter (with norm)', () => fullRouterFn('GET', path))
    bench('noNorm (skip trailing slash)', () => noNormFn('GET', path))
  })
})

console.log()
console.log('=== FULL ROUTER: /users/1/posts/2 (deep param) ===')
summary(() => {
  compact(() => {
    bench('fullRouter (with norm)', () => fullRouterFn('GET', deepPath))
    bench('noNorm (skip trailing slash)', () => noNormFn('GET', deepPath))
  })
})

await run()
