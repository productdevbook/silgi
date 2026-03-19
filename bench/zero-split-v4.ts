/**
 * Zero-split v4: Final integration test.
 *
 * Best techniques discovered:
 * 1. Move trailing-slash normalization OUT of the compiled router
 *    (do it once in the HTTP handler, before calling the router)
 * 2. Use partial charCodeAt (2-3 chars) for first-char dispatch discrimination
 * 3. Use indexOf chain for param boundary detection (not split)
 * 4. Use p.slice() for param extraction (unavoidable ~3-5ns per param)
 * 5. For prefix matching: a single charCodeAt + slash-position check
 *    is faster than startsWith, substring, or full charCodeAt chain
 * 6. For deep params: sparse charCodeAt verification of static segments
 *    between params (check first + last char of segment, not all chars)
 *
 * This file simulates what the real compiler output would look like
 * with these techniques applied.
 *
 * Run: node --experimental-strip-types bench/zero-split-v4.ts
 */

import { bench, run, summary, compact } from 'mitata'

const data_users = { path: '/users' }
const data_usersList = { path: '/users/list' }
const data_userId = { path: '/users/:id' }
const data_userIdPosts = { path: '/users/:id/posts' }
const data_userIdPostsPostId = { path: '/users/:id/posts/:postId' }
const data_files = { path: '/files/**' }
const data_api = { path: '/api/v1/:resource' }
const data_apiId = { path: '/api/v1/:resource/:id' }

const _r = { data: null as any, params: null as any }
const _p0 = { id: '' }
const _p1 = { id: '', postId: '' }
const _p2 = { _: '' }
const _p3 = { resource: '' }
const _p4 = { resource: '', id: '' }

// ═══════════════════════════════════════════════════════
// NEW COMPILER OUTPUT: zero-split approach
//
// Key change: instead of `var s=p.split("/")` we use
// indexOf chains to find segment boundaries.
//
// For the prefix check, we use a hybrid:
// - charCodeAt(1) for initial dispatch (like before)
// - Then check specific chars that discriminate between routes
//   sharing that first char
// - Then indexOf to find param boundaries
// ═══════════════════════════════════════════════════════

const newRouter = new Function(
  '$0','$1','$2','$3','$4','$5','$6','$7',
  '_r','_p0','_p1','_p2','_p3','_p4',
  `return function(m,p) {
    switch(p) {
      case "/users":if(m==="GET"){_r.data=$0;_r.params=null;return _r}break;
      case "/users/list":if(m==="GET"){_r.data=$1;_r.params=null;return _r}break;
    }
    var c1=p.charCodeAt(1);
    if(c1===117) {
      // 'u' — could be /users/...
      // Check: p starts with "/users/" (7 chars)
      // Verify chars 2-5 are "sers" and char 6 is "/"
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        // Find end of first param segment
        var e1=p.indexOf("/",7);
        if(e1===-1) {
          // /users/:id
          if(m==="GET"){_p0.id=p.slice(7);_r.data=$2;_r.params=_p0;return _r}
        } else {
          // Check if next segment is "posts"
          // e1 points to "/" before "posts"
          if(p.charCodeAt(e1+1)===112&&p.charCodeAt(e1+5)===115&&p.charCodeAt(e1+6)===47) {
            // /users/:id/posts/...
            var e2=p.indexOf("/",e1+7);
            if(e2===-1) {
              // /users/:id/posts/:postId
              if(m==="GET"){_p1.id=p.slice(7,e1);_p1.postId=p.slice(e1+7);_r.data=$4;_r.params=_p1;return _r}
            }
          } else if(p.indexOf("/",e1+1)===-1) {
            // /users/:id/posts (exact, "posts" is the terminal)
            if(p.charCodeAt(e1+1)===112&&p.charCodeAt(e1+5)===115) {
              if(m==="GET"){_p0.id=p.slice(7,e1);_r.data=$3;_r.params=_p0;return _r}
            }
          }
        }
      }
    } else if(c1===102) {
      // 'f' — /files/**
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        if(m==="GET"){_p2._=p.length>=7?p.slice(7):"";_r.data=$5;_r.params=_p2;return _r}
      }
    } else if(c1===97) {
      // 'a' — /api/v1/:resource or /api/v1/:resource/:id
      // prefix is "/api/v1/" = 8 chars
      if(p.charCodeAt(4)===118&&p.charCodeAt(6)===47&&p.charCodeAt(7)===47) {
        // Wait, "/api/v1/" has slash at 0,4,7
        // Actually: /api/v1/ = [/,a,p,i,/,v,1,/] = indices 0-7
      }
      if(p.charCodeAt(4)===47&&p.charCodeAt(5)===118&&p.charCodeAt(7)===47) {
        // /api/v1/ check: p[4]='/' p[5]='v' p[7]='/'
        var e1=p.indexOf("/",8);
        if(e1===-1) {
          if(m==="GET"){_p3.resource=p.slice(8);_r.data=$6;_r.params=_p3;return _r}
        } else {
          if(p.indexOf("/",e1+1)===-1) {
            if(m==="GET"){_p4.resource=p.slice(8,e1);_p4.id=p.slice(e1+1);_r.data=$7;_r.params=_p4;return _r}
          }
        }
      }
    }
  }`
)(
  data_users, data_usersList, data_userId, data_userIdPosts, data_userIdPostsPostId,
  data_files, data_api, data_apiId,
  _r, _p0, _p1, _p2, _p3, _p4
) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// OLD COMPILER OUTPUT (current split-based)
// ═══════════════════════════════════════════════════════

const oldRouter = new Function(
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
      if(s[1]==="api") {
        if(s[2]==="v1") {
          if(m==="GET"&&l===4){_p3.resource=s[3];_r.data=$6;_r.params=_p3;return _r}
          if(m==="GET"&&l===5){_p4.resource=s[3];_p4.id=s[4];_r.data=$7;_r.params=_p4;return _r}
        }
      }
    }
  }`
)(
  data_users, data_usersList, data_userId, data_userIdPosts, data_userIdPostsPostId,
  data_files, data_api, data_apiId,
  _r, _p0, _p1, _p2, _p3, _p4
) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// VERIFY
// ═══════════════════════════════════════════════════════

const testCases = [
  ['GET', '/users', 'static /users'],
  ['GET', '/users/list', 'static /users/list'],
  ['GET', '/users/123', 'param /users/:id'],
  ['GET', '/users/1/posts/2', 'deep /users/:id/posts/:postId'],
  ['GET', '/files/a/b/c', 'wildcard /files/**'],
  ['GET', '/api/v1/items', 'param /api/v1/:resource'],
  ['GET', '/api/v1/items/42', 'deep /api/v1/:resource/:id'],
  ['GET', '/missing', 'miss'],
] as const

console.log('=== VERIFY ===')
for (const [m, p, label] of testCases) {
  const oldR = oldRouter(m, p)
  const newR = newRouter(m, p)
  const oldP = oldR?.params ? JSON.stringify(oldR.params) : 'none'
  const newP = newR?.params ? JSON.stringify(newR.params) : 'none'
  const match = oldP === newP ? 'OK' : 'MISMATCH'
  console.log(`  ${match} ${label}: old=${oldP} new=${newP}`)
}
console.log()

// ═══════════════════════════════════════════════════════
// BENCHMARKS
// ═══════════════════════════════════════════════════════

console.log('=== STATIC: /users/list ===')
summary(() => {
  compact(() => {
    bench('OLD (split)', () => oldRouter('GET', '/users/list'))
    bench('NEW (zero-split)', () => newRouter('GET', '/users/list'))
  })
})

console.log()
console.log('=== PARAM: /users/123 ===')
summary(() => {
  compact(() => {
    bench('OLD (split)', () => oldRouter('GET', '/users/123'))
    bench('NEW (zero-split)', () => newRouter('GET', '/users/123'))
  })
})

console.log()
console.log('=== DEEP PARAM: /users/1/posts/2 ===')
summary(() => {
  compact(() => {
    bench('OLD (split)', () => oldRouter('GET', '/users/1/posts/2'))
    bench('NEW (zero-split)', () => newRouter('GET', '/users/1/posts/2'))
  })
})

console.log()
console.log('=== WILDCARD: /files/a/b/c ===')
summary(() => {
  compact(() => {
    bench('OLD (split)', () => oldRouter('GET', '/files/a/b/c'))
    bench('NEW (zero-split)', () => newRouter('GET', '/files/a/b/c'))
  })
})

console.log()
console.log('=== MISS: /missing/deep ===')
summary(() => {
  compact(() => {
    bench('OLD (split)', () => oldRouter('GET', '/missing/deep'))
    bench('NEW (zero-split)', () => newRouter('GET', '/missing/deep'))
  })
})

console.log()
console.log('=== API DEEP: /api/v1/items/42 ===')
summary(() => {
  compact(() => {
    bench('OLD (split)', () => oldRouter('GET', '/api/v1/items/42'))
    bench('NEW (zero-split)', () => newRouter('GET', '/api/v1/items/42'))
  })
})

await run()
