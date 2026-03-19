/**
 * V8 Floor — absolute minimum cost of each operation.
 * This tells us the theoretical limit for router speed.
 *
 * Run: node --experimental-strip-types bench/v8-floor.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123/posts/456'
const short = '/users/123'
const map = new Map<string, number>()
map.set('/users/list', 1)
map.set('/users/123', 2)
map.set(path, 3)

const obj: Record<string, number> = { '/users/list': 1, '/users/123': 2, [path]: 3 }

const arr = path.split('/')

// Pre-computed
const hash1 = path.length << 16 | path.charCodeAt(1) << 8 | path.charCodeAt(7)
const lookup = new Int32Array(65536)
lookup[hash1] = 42

// Result object
const _r = { v: 0 }

console.log('Path:', path, '  Length:', path.length)
console.log()

summary(() => {
  compact(() => {
    bench('noop (baseline)', () => { })
    bench('return constant', () => 42)
    bench('_r.v = 42; return _r', () => { _r.v = 42; return _r })
  })
})

summary(() => {
  compact(() => {
    bench('Map.get(path)', () => map.get(path))
    bench('obj[path]', () => obj[path])
    bench('Int32Array[hash]', () => lookup[hash1])
  })
})

summary(() => {
  compact(() => {
    bench('p.charCodeAt(1)', () => path.charCodeAt(1))
    bench('p.charCodeAt(1) === 117', () => path.charCodeAt(1) === 117)
    bench('p.length === 20', () => path.length === 20)
    bench('p === "/users/123"', () => path === short)
    bench('p.startsWith("/users/")', () => path.startsWith('/users/'))
    bench('p.startsWith("users", 1)', () => path.startsWith('users', 1))
  })
})

summary(() => {
  compact(() => {
    bench('p.indexOf("/", 7)', () => path.indexOf('/', 7))
    bench('p.indexOf("/", 1)', () => path.indexOf('/', 1))
    bench('p.slice(7)', () => path.slice(7))
    bench('p.slice(7, 10)', () => path.slice(7, 10))
    bench('p.substring(7, 10)', () => path.substring(7, 10))
    bench('p.split("/")', () => path.split('/'))
  })
})

summary(() => {
  compact(() => {
    bench('arr[2] (pre-split)', () => arr[2])
    bench('arr[2] === "123"', () => arr[2] === '123')
    bench('switch(p) 3 cases', () => {
      switch (path) {
        case '/users/list': return 1
        case '/users/123/posts/456': return 3
        case '/other': return 4
      }
    })
  })
})

// Simulated router patterns
const data = { handler: true }
const _p = { id: '' }
const _res = { data: null as any, params: null as any }

summary(() => {
  compact(() => {
    bench('full: switch static hit', () => {
      switch (short) {
        case '/users/123': _res.data = data; _res.params = null; return _res
      }
    })

    bench('full: charCodeAt + startsWith + slice', () => {
      if (short.charCodeAt(1) === 117 && short.startsWith('/users/')) {
        const e = short.indexOf('/', 7)
        if (e === -1) {
          _p.id = short.slice(7)
          _res.data = data; _res.params = _p; return _res
        }
      }
    })

    bench('full: charCodeAt + startsWith + offset only', () => {
      if (short.charCodeAt(1) === 117 && short.startsWith('/users/')) {
        const e = short.indexOf('/', 7)
        if (e === -1) {
          // Store offsets only — NO slice
          _res.data = data; _res.params = 7; return _res
        }
      }
    })

    bench('full: charCodeAt + length + manual char check', () => {
      if (short.length > 7 &&
          short.charCodeAt(1) === 117 && // u
          short.charCodeAt(2) === 115 && // s
          short.charCodeAt(3) === 101 && // e
          short.charCodeAt(4) === 114 && // r
          short.charCodeAt(5) === 115 && // s
          short.charCodeAt(6) === 47) {  // /
        const e = short.indexOf('/', 7)
        if (e === -1) {
          _p.id = short.slice(7)
          _res.data = data; _res.params = _p; return _res
        }
      }
    })

    bench('full: split + s[1] + s[2]', () => {
      const s = short.split('/')
      if (s[1] === 'users' && s.length === 3) {
        _p.id = s[2]!
        _res.data = data; _res.params = _p; return _res
      }
    })
  })
})

await run()
