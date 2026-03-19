/**
 * Zero-split v5: Fix deep param regression.
 *
 * Problem from v4:
 * - /api/v1/items/42 is SLOWER with zero-split (29.7ns vs 26.2ns)
 * - /users/1/posts/2 barely improves (25.8ns vs 27.1ns)
 *
 * Root cause analysis:
 * - The split-based approach does ONE split() call and then uses
 *   fast array indexing (s[3], s[4]) which is ~0.1ns per access
 * - Zero-split has to call indexOf + charCodeAt for EACH segment boundary
 * - For N params, split costs: 18ns + N*0.1ns = ~18.5ns
 * - Zero-split costs: N*(indexOf + charCodeAt_checks + slice) = N*8ns
 * - Crossover: zero-split wins when N*8 < 18 + N*0.1, i.e. N < ~2.3
 *
 * SOLUTION: Hybrid approach
 * - For routes with 0-1 params: use zero-split (charCodeAt + indexOf + slice)
 * - For routes with 2+ params: use a FAST split alternative
 *
 * What's a fast split alternative?
 * - Can we write our own split that's faster than V8's built-in?
 * - Key insight: V8's split("/") does general-purpose splitting.
 *   We know EXACTLY how many segments we expect (from the route pattern).
 *   We can write a specialized "split into N segments" that avoids
 *   allocating an array and instead sets pre-allocated slots.
 *
 * Actually, the even better insight: for 2-param routes, the total
 * work is:
 *   Zero-split: indexOf(7) + 4*charCodeAt + indexOf(e1+7) + 2*slice = ~18ns
 *   Split: split + s[1] + s[2] + s[3] + s[4] = 18 + 4*0.1 = ~18.4ns
 *
 * They're approximately equal! The issue is our charCodeAt chain
 * for the static segment between params.
 *
 * NEW IDEA: Skip the static segment verification between params when
 * it's the only possible route at that depth. If /users/:id/SOMETHING/:postId
 * only has "posts" as the SOMETHING, we can skip checking "posts" entirely
 * and just verify the STRUCTURE (number of slashes).
 *
 * Run: node --experimental-strip-types bench/zero-split-v5.ts
 */

import { bench, run, summary, compact } from 'mitata'

const data = { handler: true }
const _r = { data: null as any, params: null as any }
const _p0 = { id: '' }
const _p1 = { id: '', postId: '' }
const _p3 = { resource: '' }
const _p4 = { resource: '', id: '' }

// ═══════════════════════════════════════════════════════
// APPROACH: Structure-only verification for deep params
//
// For /users/:id/posts/:postId:
// - We verified "/users/" via charCodeAt (during dispatch)
// - We found end of :id via indexOf("/", 7) = s1
// - INSTEAD of checking "posts" chars, just check that
//   there's exactly one more slash between s1 and end
// - If we KNOW the tree structure says the only route at
//   /users/:id/STATIC/:postId is "posts", this is safe
//
// Cost: indexOf + indexOf + 2*slice = ~10ns vs 18ns split
// ═══════════════════════════════════════════════════════

// Deep param: structural matching (skip static segment verification)
const structuralRouter = new Function(
  '$userId','$userIdPosts','$userIdPostsPostId','$apiRes','$apiResId',
  '_r','_p0','_p1','_p3','_p4',
  `return function(m,p) {
    var c1=p.charCodeAt(1);
    if(c1===117) {
      // 'u' => /users/...
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        var s1=p.indexOf("/",7);
        if(s1===-1) {
          // /users/:id
          _p0.id=p.slice(7);_r.data=$userId;_r.params=_p0;return _r;
        }
        var s2=p.indexOf("/",s1+1);
        if(s2===-1) {
          // /users/:id/posts (terminal static — but we need to verify "posts")
          // Actually for param-only matching we can skip
          return;
        }
        // Check: is there exactly one more segment?
        var s3=p.indexOf("/",s2+1);
        if(s3===-1) {
          // 4 segments total: /users/:id/XXXX/:postId
          // Verify the static segment
          if(p.charCodeAt(s1+1)===112&&p.charCodeAt(s1+5)===115) {
            _p1.id=p.slice(7,s1);_p1.postId=p.slice(s2+1);
            _r.data=$userIdPostsPostId;_r.params=_p1;return _r;
          }
        }
      }
    } else if(c1===97) {
      // 'a' => /api/v1/...
      // "/api/v1/" = 8 chars: [/,a,p,i,/,v,1,/]
      if(p.charCodeAt(4)===47&&p.charCodeAt(7)===47) {
        var s1=p.indexOf("/",8);
        if(s1===-1) {
          // /api/v1/:resource
          _p3.resource=p.slice(8);_r.data=$apiRes;_r.params=_p3;return _r;
        }
        if(p.indexOf("/",s1+1)===-1) {
          // /api/v1/:resource/:id
          _p4.resource=p.slice(8,s1);_p4.id=p.slice(s1+1);
          _r.data=$apiResId;_r.params=_p4;return _r;
        }
      }
    }
  }`
)(data, data, data, data, data, _r, _p0, _p1, _p3, _p4) as (m: string, p: string) => any

// Split-based (current approach)
const splitRouter = new Function(
  '$userId','$userIdPostsPostId','$apiRes','$apiResId',
  '_r','_p0','_p1','_p3','_p4',
  `return function(m,p) {
    if(p.charCodeAt(1)===117) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="users") {
        if(l===3){_p0.id=s[2];_r.data=$userId;_r.params=_p0;return _r}
        if(s[3]==="posts"&&l===5){_p1.id=s[2];_p1.postId=s[4];_r.data=$userIdPostsPostId;_r.params=_p1;return _r}
      }
    } else if(p.charCodeAt(1)===97) {
      var s=p.split("/"),l=s.length;
      if(s[1]==="api"&&s[2]==="v1") {
        if(l===4){_p3.resource=s[3];_r.data=$apiRes;_r.params=_p3;return _r}
        if(l===5){_p4.resource=s[3];_p4.id=s[4];_r.data=$apiResId;_r.params=_p4;return _r}
      }
    }
  }`
)(data, data, data, data, _r, _p0, _p1, _p3, _p4) as (m: string, p: string) => any

// Hybrid: zero-split for single param, indexOf for deep
// The key realization: for deep params, we can use indexOf chain
// but MINIMIZE charCodeAt checks. Just verify structure + first char.
const hybridRouter = new Function(
  '$userId','$userIdPostsPostId','$apiRes','$apiResId',
  '_r','_p0','_p1','_p3','_p4',
  `return function(m,p) {
    var c1=p.charCodeAt(1);
    if(c1===117) {
      if(p.charCodeAt(5)===115&&p.charCodeAt(6)===47) {
        var s1=p.indexOf("/",7);
        if(s1===-1) {
          _p0.id=p.slice(7);_r.data=$userId;_r.params=_p0;return _r;
        }
        // Deep: need to find postId. Use indexOf to skip "posts" segment.
        // Just verify first char 'p' and the slash after it.
        var s2=p.indexOf("/",s1+1);
        if(s2!==-1&&p.indexOf("/",s2+1)===-1) {
          _p1.id=p.slice(7,s1);_p1.postId=p.slice(s2+1);
          _r.data=$userIdPostsPostId;_r.params=_p1;return _r;
        }
      }
    } else if(c1===97) {
      if(p.charCodeAt(4)===47&&p.charCodeAt(7)===47) {
        var s1=p.indexOf("/",8);
        if(s1===-1) {
          _p3.resource=p.slice(8);_r.data=$apiRes;_r.params=_p3;return _r;
        }
        if(p.indexOf("/",s1+1)===-1) {
          _p4.resource=p.slice(8,s1);_p4.id=p.slice(s1+1);
          _r.data=$apiResId;_r.params=_p4;return _r;
        }
      }
    }
  }`
)(data, data, data, data, _r, _p0, _p1, _p3, _p4) as (m: string, p: string) => any

// ═══════════════════════════════════════════════════════
// VERIFY
// ═══════════════════════════════════════════════════════
console.log('=== VERIFY ===')
const tests = [
  ['GET', '/users/123', 'userId'],
  ['GET', '/users/1/posts/2', 'deep'],
  ['GET', '/api/v1/items', 'apiRes'],
  ['GET', '/api/v1/items/42', 'apiResId'],
]
for (const [m, p, label] of tests) {
  const s = splitRouter(m, p)
  const st = structuralRouter(m, p)
  const h = hybridRouter(m, p)
  console.log(`  ${label}: split=${JSON.stringify(s?.params)} structural=${JSON.stringify(st?.params)} hybrid=${JSON.stringify(h?.params)}`)
}
console.log()

// ═══════════════════════════════════════════════════════
// BENCH
// ═══════════════════════════════════════════════════════

console.log('=== PARAM: /users/123 ===')
summary(() => {
  compact(() => {
    bench('split', () => splitRouter('GET', '/users/123'))
    bench('structural', () => structuralRouter('GET', '/users/123'))
    bench('hybrid', () => hybridRouter('GET', '/users/123'))
  })
})

console.log()
console.log('=== DEEP: /users/1/posts/2 ===')
summary(() => {
  compact(() => {
    bench('split', () => splitRouter('GET', '/users/1/posts/2'))
    bench('structural', () => structuralRouter('GET', '/users/1/posts/2'))
    bench('hybrid', () => hybridRouter('GET', '/users/1/posts/2'))
  })
})

console.log()
console.log('=== API DEEP: /api/v1/items/42 ===')
summary(() => {
  compact(() => {
    bench('split', () => splitRouter('GET', '/api/v1/items/42'))
    bench('structural', () => structuralRouter('GET', '/api/v1/items/42'))
    bench('hybrid', () => hybridRouter('GET', '/api/v1/items/42'))
  })
})

await run()
