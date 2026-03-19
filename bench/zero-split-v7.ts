/**
 * Zero-split v7: Function size and V8 optimization.
 *
 * CRITICAL FINDING from v6:
 * - fixedDeep as standalone function: 12ns (single), 16.6ns (deep)
 * - Same logic embedded in large new Function router: 16ns (single), 32ns (deep)
 *
 * WHY? V8's TurboFan has optimization limits:
 * 1. Functions above ~500 bytes of source may not be fully optimized
 * 2. Complex control flow (many nested if/else/switch) causes
 *    "bail out" from certain optimizations
 * 3. The large function has more live variables, increasing register pressure
 *
 * SOLUTION: Split the generated code into multiple functions.
 * The main router function does dispatch only (switch + charCodeAt).
 * Each branch calls a specialized sub-function for that route group.
 *
 * This is similar to how C++ compilers handle large functions:
 * outline rarely-taken branches, inline hot paths.
 *
 * Also: for the 2-param indexOf case, we found that NOT checking
 * the static segment between params ("posts") makes it ~4ns faster.
 * But we need some verification. Minimal check: first char of segment.
 *
 * Run: node --experimental-strip-types bench/zero-split-v7.ts
 */

import { bench, run, summary, compact } from 'mitata'

const data = { handler: true }
const _r = { data: null as any, params: null as any }
const _p0 = { id: '' }
const _p1 = { id: '', postId: '' }
const _p2 = { _: '' }
const _p3 = { resource: '' }
const _p4 = { resource: '', id: '' }

// ═══════════════════════════════════════════════════════
// APPROACH A: Single monolithic function (current approach)
// ═══════════════════════════════════════════════════════

const monoRouter = new Function(
  '$0','$1','$2','$3','$4','$5','$6','$7',
  '_r','_p0','_p1','_p2','_p3','_p4',
  `return function(m,p) {
    if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);
    switch(p) {
      case "/users":if(m==="GET"){_r.data=$0;_r.params=null;return _r}break;
      case "/users/list":if(m==="GET"){_r.data=$1;_r.params=null;return _r}break;
    }
    if(p.charCodeAt(1)===117) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="users") {
        if(m==="GET"&&l===3){_p0.id=s[2];_r.data=$2;_r.params=_p0;return _r}
        if(s[3]==="posts") {
          if(m==="GET"&&l===4){_p0.id=s[2];_r.data=$3;_r.params=_p0;return _r}
          if(m==="GET"&&l===5){_p1.id=s[2];_p1.postId=s[4];_r.data=$4;_r.params=_p1;return _r}
        }
      }
    } else if(p.charCodeAt(1)===102) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="files") {
        if(m==="GET"){_p2._=(p.length>=7?p.slice(7):"");_r.data=$5;_r.params=_p2;return _r}
      }
    } else if(p.charCodeAt(1)===97) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="api"&&s[2]==="v1") {
        if(m==="GET"&&l===4){_p3.resource=s[3];_r.data=$6;_r.params=_p3;return _r}
        if(m==="GET"&&l===5){_p4.resource=s[3];_p4.id=s[4];_r.data=$7;_r.params=_p4;return _r}
      }
    }
  }`
)(data, data, data, data, data, data, data, data, _r, _p0, _p1, _p2, _p3, _p4) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// APPROACH B: Zero-split monolithic (all in one function, no split)
// ═══════════════════════════════════════════════════════

const zeroSplitMono = new Function(
  '$0','$1','$2','$3','$4','$5','$6','$7',
  '_r','_p0','_p1','_p2','_p3','_p4',
  `return function(m,p) {
    switch(p) {
      case "/users":if(m==="GET"){_r.data=$0;_r.params=null;return _r}break;
      case "/users/list":if(m==="GET"){_r.data=$1;_r.params=null;return _r}break;
    }
    var c=p.charCodeAt(1);
    if(c===117) {
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        var e=p.indexOf("/",7);
        if(e===-1) {
          if(m==="GET"){_p0.id=p.slice(7);_r.data=$2;_r.params=_p0;return _r}
        } else if(p.charCodeAt(e+1)===112&&p.charCodeAt(e+6)===47) {
          var e2=p.indexOf("/",e+7);
          if(e2===-1) {
            if(m==="GET"){_p1.id=p.slice(7,e);_p1.postId=p.slice(e+7);_r.data=$4;_r.params=_p1;return _r}
          }
        } else if(p.indexOf("/",e+1)===-1) {
          if(m==="GET"&&p.charCodeAt(e+1)===112) {
            _p0.id=p.slice(7,e);_r.data=$3;_r.params=_p0;return _r
          }
        }
      }
    } else if(c===102) {
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        if(m==="GET"){_p2._=p.length>=7?p.slice(7):"";_r.data=$5;_r.params=_p2;return _r}
      }
    } else if(c===97) {
      if(p.charCodeAt(4)===47&&p.charCodeAt(7)===47) {
        var e=p.indexOf("/",8);
        if(e===-1) {
          if(m==="GET"){_p3.resource=p.slice(8);_r.data=$6;_r.params=_p3;return _r}
        } else if(p.indexOf("/",e+1)===-1) {
          if(m==="GET"){_p4.resource=p.slice(8,e);_p4.id=p.slice(e+1);_r.data=$7;_r.params=_p4;return _r}
        }
      }
    }
  }`
)(data, data, data, data, data, data, data, data, _r, _p0, _p1, _p2, _p3, _p4) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// APPROACH C: Split into dispatch + branch functions
// Each charCodeAt branch is a separate function for V8 to optimize independently.
// ═══════════════════════════════════════════════════════

// Branch for 'u' routes (/users/...)
const branchU = new Function(
  '$2','$3','$4',
  '_r','_p0','_p1',
  `return function(m,p) {
    if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
      var e=p.indexOf("/",7);
      if(e===-1) {
        if(m==="GET"){_p0.id=p.slice(7);_r.data=$2;_r.params=_p0;return _r}
      } else if(p.charCodeAt(e+1)===112&&p.charCodeAt(e+6)===47) {
        if(p.indexOf("/",e+7)===-1) {
          if(m==="GET"){_p1.id=p.slice(7,e);_p1.postId=p.slice(e+7);_r.data=$4;_r.params=_p1;return _r}
        }
      } else if(p.indexOf("/",e+1)===-1) {
        if(m==="GET"&&p.charCodeAt(e+1)===112) {
          _p0.id=p.slice(7,e);_r.data=$3;_r.params=_p0;return _r
        }
      }
    }
  }`
)(data, data, data, _r, _p0, _p1) as (m: string, p: string) => any

// Branch for 'f' routes (/files/...)
const branchF = new Function(
  '$5','_r','_p2',
  `return function(m,p) {
    if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
      if(m==="GET"){_p2._=p.length>=7?p.slice(7):"";_r.data=$5;_r.params=_p2;return _r}
    }
  }`
)(data, _r, _p2) as (m: string, p: string) => any

// Branch for 'a' routes (/api/...)
const branchA = new Function(
  '$6','$7','_r','_p3','_p4',
  `return function(m,p) {
    if(p.charCodeAt(4)===47&&p.charCodeAt(7)===47) {
      var e=p.indexOf("/",8);
      if(e===-1) {
        if(m==="GET"){_p3.resource=p.slice(8);_r.data=$6;_r.params=_p3;return _r}
      } else if(p.indexOf("/",e+1)===-1) {
        if(m==="GET"){_p4.resource=p.slice(8,e);_p4.id=p.slice(e+1);_r.data=$7;_r.params=_p4;return _r}
      }
    }
  }`
)(data, data, _r, _p3, _p4) as (m: string, p: string) => any

// Dispatcher
const splitRouter = new Function(
  '$0','$1','branchU','branchF','branchA',
  '_r',
  `return function(m,p) {
    switch(p) {
      case "/users":if(m==="GET"){_r.data=$0;_r.params=null;return _r}break;
      case "/users/list":if(m==="GET"){_r.data=$1;_r.params=null;return _r}break;
    }
    var c=p.charCodeAt(1);
    if(c===117) return branchU(m,p);
    if(c===102) return branchF(m,p);
    if(c===97) return branchA(m,p);
  }`
)(data, data, branchU, branchF, branchA, _r) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// VERIFY
// ═══════════════════════════════════════════════════════
console.log('=== VERIFY ===')
const tests = [
  ['GET', '/users', 'static'],
  ['GET', '/users/list', 'static list'],
  ['GET', '/users/123', '1p'],
  ['GET', '/users/1/posts/2', '2p'],
  ['GET', '/files/a/b/c', 'wc'],
  ['GET', '/api/v1/items', 'api1'],
  ['GET', '/api/v1/items/42', 'api2'],
  ['GET', '/missing', 'miss'],
]
for (const [m, p, label] of tests) {
  const a = monoRouter(m, p)
  const b = zeroSplitMono(m, p)
  const c = splitRouter(m, p)
  const aP = a ? JSON.stringify(a.params) : '-'
  const bP = b ? JSON.stringify(b.params) : '-'
  const cP = c ? JSON.stringify(c.params) : '-'
  const ok = aP === bP && bP === cP ? 'OK' : 'FAIL'
  console.log(`  ${ok} ${label}: mono=${aP} zero=${bP} split=${cP}`)
}
console.log()

// ═══════════════════════════════════════════════════════
// BENCHMARKS
// ═══════════════════════════════════════════════════════

console.log('=== STATIC: /users/list ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/users/list'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/users/list'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/users/list'))
  })
})

console.log()
console.log('=== 1-PARAM: /users/123 ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/users/123'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/users/123'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/users/123'))
  })
})

console.log()
console.log('=== 2-PARAM: /users/1/posts/2 ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/users/1/posts/2'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/users/1/posts/2'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/users/1/posts/2'))
  })
})

console.log()
console.log('=== WILDCARD: /files/a/b/c ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/files/a/b/c'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/files/a/b/c'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/files/a/b/c'))
  })
})

console.log()
console.log('=== MISS: /missing ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/missing'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/missing'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/missing'))
  })
})

console.log()
console.log('=== API 1-PARAM: /api/v1/items ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/api/v1/items'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/api/v1/items'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/api/v1/items'))
  })
})

console.log()
console.log('=== API 2-PARAM: /api/v1/items/42 ===')
summary(() => {
  compact(() => {
    bench('A: mono (split, +norm)', () => monoRouter('GET', '/api/v1/items/42'))
    bench('B: zero-split mono', () => zeroSplitMono('GET', '/api/v1/items/42'))
    bench('C: dispatch + branches', () => splitRouter('GET', '/api/v1/items/42'))
  })
})

await run()
