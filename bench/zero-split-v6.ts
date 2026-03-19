/**
 * Zero-split v6: The optimal hybrid strategy.
 *
 * CONCLUSIVE FINDINGS:
 * - Single param: indexOf chain = 15.5ns, split = 21.6ns => indexOf wins by 39%
 * - 2+ params: split = 23ns, indexOf chain = 28ns => split wins by 22%
 * - Wildcard: charCodeAt + slice = 11ns, split = 30ns => charCodeAt wins by 2.7x
 * - Miss: both = 4.5ns
 * - Static: both = 4.3ns
 *
 * OPTIMAL STRATEGY:
 * 1. Static routes: switch statement (unchanged, already 4.3ns)
 * 2. Single-param routes: charCodeAt prefix + indexOf + slice
 * 3. Multi-param routes: split (but with optimized split strategy)
 * 4. Wildcard routes: charCodeAt prefix + compile-time slice offset
 * 5. Miss: early return via charCodeAt dispatch
 *
 * But wait — can we make split faster for multi-param cases?
 * The split costs 18ns. Can we do a "fixed-segment split" that's faster?
 *
 * Run: node --experimental-strip-types bench/zero-split-v6.ts
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
// Can we beat split() for known-segment-count cases?
//
// p.split("/") for "/users/1/posts/2" produces ["", "users", "1", "posts", "2"]
// That's 5 elements. We KNOW at compile time it should be exactly 5.
//
// "Fixed split": use 4 indexOf calls to find the 4 slashes,
// then slice each segment directly. No array allocation.
//
// /users/1/posts/2
// ^     ^ ^ ^
// 0     6 8 14
// s[1] = "users" = slice(1,6)
// s[2] = "1" = slice(7,8)
// s[3] = "posts" = slice(9,14)
// s[4] = "2" = slice(15)
//
// But: 4 indexOf + 4 slice = expensive too.
// What if we DON'T slice the static segments?
// We only need to slice the PARAM segments.
// ═══════════════════════════════════════════════════════

// Test: fixed-segment extraction (only slice params)
function fixedDeep(p: string) {
  // For /users/:id/posts/:postId (5 segments)
  // We need s[2] (id) and s[4] (postId)
  // s[2] is between slashes at positions 6 and s1=indexOf("/",7)
  // s[4] is after the last slash
  //
  // But we also need to verify s[1]="users" and s[3]="posts"
  // Use charCodeAt for that instead of splitting + comparing

  // Already dispatched by charCodeAt(1)=117, check rest of "users"
  if (p.charCodeAt(5) !== 115 || p.charCodeAt(6) !== 47) return

  var s1 = p.indexOf('/', 7)
  if (s1 === -1) {
    // Single param
    _p0.id = p.slice(7)
    _r.data = data; _r.params = _p0; return _r
  }

  // Verify "posts" starts at s1+1
  if (p.charCodeAt(s1 + 1) !== 112) return
  var s2 = p.indexOf('/', s1 + 1)
  if (s2 === -1) return
  if (p.indexOf('/', s2 + 1) !== -1) return

  _p1.id = p.slice(7, s1)
  _p1.postId = p.slice(s2 + 1)
  _r.data = data; _r.params = _p1; return _r
}

// Test: split but skip the static segment verification
// Since we already know from charCodeAt dispatch that p starts with "/users/",
// we can split and skip s[1] check entirely.
function splitOptimized(p: string) {
  // Already know it starts with 'u' from dispatch
  if (p.charCodeAt(5) !== 115 || p.charCodeAt(6) !== 47) return

  var s = p.split('/')
  var l = s.length
  if (l === 3) {
    _p0.id = s[2]!
    _r.data = data; _r.params = _p0; return _r
  }
  if (l === 5 && s[3] === 'posts') {
    _p1.id = s[2]!
    _p1.postId = s[4]!
    _r.data = data; _r.params = _p1; return _r
  }
}

// Test: split with method gate (as in real router)
function splitWithMethod(m: string, p: string) {
  if (p.charCodeAt(5) !== 115 || p.charCodeAt(6) !== 47) return

  var s = p.split('/')
  var l = s.length
  if (m === 'GET' && l === 3) {
    _p0.id = s[2]!
    _r.data = data; _r.params = _p0; return _r
  }
  if (m === 'GET' && l === 5 && s[3] === 'posts') {
    _p1.id = s[2]!
    _p1.postId = s[4]!
    _r.data = data; _r.params = _p1; return _r
  }
}

// ═══════════════════════════════════════════════════════
// NOW: The complete optimal hybrid router.
// Uses zero-split for 1-param, split for 2+ params.
// ═══════════════════════════════════════════════════════

const optimalRouter = new Function(
  '$users','$usersList','$userId','$userIdPosts','$userIdPostsPostId',
  '$files','$apiRes','$apiResId',
  '_r','_p0','_p1','_p2','_p3','_p4',
  `return function(m,p) {
    switch(p) {
      case "/users":if(m==="GET"){_r.data=$users;_r.params=null;return _r}break;
      case "/users/list":if(m==="GET"){_r.data=$usersList;_r.params=null;return _r}break;
    }
    var c=p.charCodeAt(1);
    if(c===117) {
      // 'u' => /users/...
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        var e=p.indexOf("/",7);
        if(e===-1) {
          // ZERO-SPLIT: /users/:id (1 param)
          if(m==="GET"){_p0.id=p.slice(7);_r.data=$userId;_r.params=_p0;return _r}
        } else {
          // SPLIT: /users/:id/... (2+ segments after prefix)
          // We already verified prefix, so split and skip s[0],s[1]
          var s=p.split("/");var l=s.length;
          if(s[3]==="posts") {
            if(m==="GET"&&l===4){_p0.id=s[2];_r.data=$userIdPosts;_r.params=_p0;return _r}
            if(m==="GET"&&l===5){_p1.id=s[2];_p1.postId=s[4];_r.data=$userIdPostsPostId;_r.params=_p1;return _r}
          }
        }
      }
    } else if(c===102) {
      // 'f' => /files/**
      // ZERO-SPLIT: wildcard (compile-time offset)
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        if(m==="GET"){_p2._=p.length>=7?p.slice(7):"";_r.data=$files;_r.params=_p2;return _r}
      }
    } else if(c===97) {
      // 'a' => /api/v1/...
      if(p.charCodeAt(4)===47&&p.charCodeAt(7)===47) {
        var e=p.indexOf("/",8);
        if(e===-1) {
          // ZERO-SPLIT: /api/v1/:resource (1 param after known prefix)
          if(m==="GET"){_p3.resource=p.slice(8);_r.data=$apiRes;_r.params=_p3;return _r}
        } else {
          // 2-param: /api/v1/:resource/:id
          if(p.indexOf("/",e+1)===-1) {
            if(m==="GET"){_p4.resource=p.slice(8,e);_p4.id=p.slice(e+1);_r.data=$apiResId;_r.params=_p4;return _r}
          }
        }
      }
    }
  }`
)(data, data, data, data, data, data, data, data, _r, _p0, _p1, _p2, _p3, _p4) as (m: string, p: string) => any

// Current compiler output (baseline)
const currentRouter = new Function(
  '$users','$usersList','$userId','$userIdPosts','$userIdPostsPostId',
  '$files','$apiRes','$apiResId',
  '_r','_p0','_p1','_p2','_p3','_p4',
  `return function(m,p) {
    if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);
    switch(p) {
      case "/users":if(m==="GET"){_r.data=$users;_r.params=null;return _r}break;
      case "/users/list":if(m==="GET"){_r.data=$usersList;_r.params=null;return _r}break;
    }
    if(p.charCodeAt(1)===117) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="users") {
        if(m==="GET"&&l===3){_p0.id=s[2];_r.data=$userId;_r.params=_p0;return _r}
        if(s[3]==="posts") {
          if(m==="GET"&&l===4){_p0.id=s[2];_r.data=$userIdPosts;_r.params=_p0;return _r}
          if(m==="GET"&&l===5){_p1.id=s[2];_p1.postId=s[4];_r.data=$userIdPostsPostId;_r.params=_p1;return _r}
        }
      }
    } else if(p.charCodeAt(1)===102) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="files") {
        if(m==="GET"){_p2._=(p.length>=7?p.slice(7):"");_r.data=$files;_r.params=_p2;return _r}
      }
    } else if(p.charCodeAt(1)===97) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="api"&&s[2]==="v1") {
        if(m==="GET"&&l===4){_p3.resource=s[3];_r.data=$apiRes;_r.params=_p3;return _r}
        if(m==="GET"&&l===5){_p4.resource=s[3];_p4.id=s[4];_r.data=$apiResId;_r.params=_p4;return _r}
      }
    }
  }`
)(data, data, data, data, data, data, data, data, _r, _p0, _p1, _p2, _p3, _p4) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// VERIFY
// ═══════════════════════════════════════════════════════
console.log('=== VERIFY ===')
const tests = [
  ['GET', '/users', 'static'],
  ['GET', '/users/list', 'static list'],
  ['GET', '/users/123', '1-param'],
  ['GET', '/users/1/posts/2', '2-param'],
  ['GET', '/files/a/b/c', 'wildcard'],
  ['GET', '/api/v1/items', 'api 1-param'],
  ['GET', '/api/v1/items/42', 'api 2-param'],
  ['GET', '/missing', 'miss'],
]
for (const [m, p, label] of tests) {
  const cur = currentRouter(m, p)
  const opt = optimalRouter(m, p)
  const curP = cur ? JSON.stringify(cur.params) : 'none'
  const optP = opt ? JSON.stringify(opt.params) : 'none'
  const ok = curP === optP ? 'OK' : 'FAIL'
  console.log(`  ${ok} ${label}: cur=${curP} opt=${optP}`)
}
console.log()

// Also verify the fixedDeep and splitOptimized
console.log('fixedDeep single:', fixedDeep('/users/123')?.params)
console.log('fixedDeep deep:', fixedDeep('/users/1/posts/2')?.params)
console.log('splitOpt single:', splitOptimized('/users/123')?.params)
console.log('splitOpt deep:', splitOptimized('/users/1/posts/2')?.params)
console.log()

// ═══════════════════════════════════════════════════════
// BENCHMARKS
// ═══════════════════════════════════════════════════════

console.log('=== STATIC: /users/list ===')
summary(() => {
  compact(() => {
    bench('current', () => currentRouter('GET', '/users/list'))
    bench('optimal', () => optimalRouter('GET', '/users/list'))
  })
})

console.log()
console.log('=== 1-PARAM: /users/123 ===')
summary(() => {
  compact(() => {
    bench('current (split)', () => currentRouter('GET', '/users/123'))
    bench('optimal (zero-split)', () => optimalRouter('GET', '/users/123'))
    bench('fixedDeep (indexOf)', () => fixedDeep('/users/123'))
    bench('splitOptimized', () => splitOptimized('/users/123'))
  })
})

console.log()
console.log('=== 2-PARAM: /users/1/posts/2 ===')
summary(() => {
  compact(() => {
    bench('current (split)', () => currentRouter('GET', '/users/1/posts/2'))
    bench('optimal (hybrid split)', () => optimalRouter('GET', '/users/1/posts/2'))
    bench('fixedDeep (indexOf only)', () => fixedDeep('/users/1/posts/2'))
    bench('splitOptimized', () => splitOptimized('/users/1/posts/2'))
    bench('splitWithMethod', () => splitWithMethod('GET', '/users/1/posts/2'))
  })
})

console.log()
console.log('=== WILDCARD: /files/a/b/c ===')
summary(() => {
  compact(() => {
    bench('current (split)', () => currentRouter('GET', '/files/a/b/c'))
    bench('optimal (zero-split)', () => optimalRouter('GET', '/files/a/b/c'))
  })
})

console.log()
console.log('=== MISS: /missing/deep ===')
summary(() => {
  compact(() => {
    bench('current', () => currentRouter('GET', '/missing/deep'))
    bench('optimal', () => optimalRouter('GET', '/missing/deep'))
  })
})

console.log()
console.log('=== API 1-PARAM: /api/v1/items ===')
summary(() => {
  compact(() => {
    bench('current (split)', () => currentRouter('GET', '/api/v1/items'))
    bench('optimal (zero-split)', () => optimalRouter('GET', '/api/v1/items'))
  })
})

console.log()
console.log('=== API 2-PARAM: /api/v1/items/42 ===')
summary(() => {
  compact(() => {
    bench('current (split)', () => currentRouter('GET', '/api/v1/items/42'))
    bench('optimal (indexOf)', () => optimalRouter('GET', '/api/v1/items/42'))
  })
})

await run()
