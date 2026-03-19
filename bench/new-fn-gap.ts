/**
 * Diagnostic: Why is new Function() 14x slower than inline?
 *
 * Tests 7 hypotheses for the inline-vs-generated performance gap.
 * Each experiment isolates one variable.
 *
 * Run: node --experimental-strip-types bench/new-fn-gap.ts
 *
 * For V8 tracing (see which functions get optimized):
 *   node --experimental-strip-types --trace-opt --trace-deopt bench/new-fn-gap.ts 2>&1 | grep -E 'OPTIMIZED|optimizing|deoptimizing'
 *
 * For detailed TurboFan IR:
 *   node --experimental-strip-types --print-opt-code --code-comments bench/new-fn-gap.ts
 */

import { bench, run, summary, compact } from 'mitata'

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Setup: reproduce the exact pattern from compiler.ts
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const path = '/users/123'
const data = { handler: true }

// ── Hypothesis 1: new Function() itself is the problem ──────────
//
// V8 treats new Function() code as "eval-style" code. This matters:
// - Eval code gets its own Script object and separate optimization budget
// - The outer closure capturing $0, $1 etc creates a "context" object
//   on the heap instead of register-allocated locals
// - TurboFan may not inline across eval boundaries
//
// TEST: same logic, new Function() vs inline function

// Inline version (the "gold standard")
const _r_inline = { data: null as any, params: null as any }
const _lp_inline = {
  _p: '',
  _o: new Int32Array(2),
  get id() { return this._p.slice(this._o[0]!, this._o[1]!) },
  toJSON() { const r: any = {}; for (const k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = (this as any)[k]; return r },
}

function matchInline(m: string, p: string) {
  if (p.charCodeAt(1) === 117) {
    if (p.charCodeAt(6) === 47 || p.length === 6) {
      if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
        _lp_inline._p = p
        _lp_inline._o[0] = 7
        _lp_inline._o[1] = p.length
        _r_inline.data = data
        _r_inline.params = _lp_inline
        return _r_inline
      }
    }
  }
}

// new Function() version — same logic, same pre-allocated objects
const matchNewFn = new Function(
  '$data',
  `
  var _r = { data: null, params: null };
  var _lp = {
    _p: '',
    _o: new Int32Array(2),
    get id() { return this._p.slice(this._o[0], this._o[1]); },
    toJSON() { var r = {}; for (var k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = this[k]; return r; },
  };
  return function matchGenFn(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp._p = p;
          _lp._o[0] = 7;
          _lp._o[1] = p.length;
          _r.data = $data;
          _r.params = _lp;
          return _r;
        }
      }
    }
  };
  `,
)(data)

console.log('=== VERIFY ===')
console.log('inline:', matchInline('GET', path)?.params?.id)
console.log('newFn:', matchNewFn('GET', path)?.params?.id)
console.log()

// ── Hypothesis 2: Closure scope ($0 ref) adds deopt pressure ────
//
// When new Function() captures variables via its argument names ($0, $1),
// V8 creates a SharedFunctionInfo with context slots. Each access to $0
// requires a context load instruction instead of a register reference.
//
// TEST: pass data as argument vs close over it

const matchNewFn_argRef = new Function(
  '$0',
  `
  var _r = { data: null, params: null };
  var _lp = {
    _p: '',
    _o: new Int32Array(2),
    get id() { return this._p.slice(this._o[0], this._o[1]); },
    toJSON() { var r = {}; for (var k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = this[k]; return r; },
  };
  return function(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp._p = p;
          _lp._o[0] = 7;
          _lp._o[1] = p.length;
          _r.data = $0;
          _r.params = _lp;
          return _r;
        }
      }
    }
  };
  `,
)(data)

// No closure — data baked into the function body as a literal (impossible for
// objects, but we can test with a primitive to see if context access matters)
const matchNewFn_noClose = new Function(
  `
  var _r = { data: null, params: null };
  var _lp = {
    _p: '',
    _o: new Int32Array(2),
    get id() { return this._p.slice(this._o[0], this._o[1]); },
    toJSON() { var r = {}; for (var k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = this[k]; return r; },
  };
  var $data = { handler: true };
  return function(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp._p = p;
          _lp._o[0] = 7;
          _lp._o[1] = p.length;
          _r.data = $data;
          _r.params = _lp;
          return _r;
        }
      }
    }
  };
  `,
)()

// ── Hypothesis 3: The lazy getter object is the bottleneck ──────
//
// Objects with getters have different hidden classes. V8 may not
// optimize property stores to objects with accessor properties as well.
// The `_lp` object has a getter for `id` — this changes its Map (hidden class).
//
// TEST: plain object (no getters) vs getter object

const matchNewFn_plainObj = new Function(
  '$0',
  `
  var _r = { data: null, params: null };
  var _lp = { _p: '', _s: 0, _e: 0, id: '' };
  return function(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp.id = p.slice(7);
          _r.data = $0;
          _r.params = _lp;
          return _r;
        }
      }
    }
  };
  `,
)(data)

// No params object at all — just store offsets in _r directly
const matchNewFn_noParams = new Function(
  '$0',
  `
  var _r = { data: null, params: null, _s: 0, _e: 0, _p: '' };
  return function(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _r._p = p;
          _r._s = 7;
          _r._e = p.length;
          _r.data = $0;
          _r.params = _r;
          return _r;
        }
      }
    }
  };
  `,
)(data)

// ── Hypothesis 4: The Int32Array write is slow in generated code ─
//
// Int32Array element writes go through a different IC (inline cache) path.
// In generated code, V8 may not specialize the element access as aggressively.
//
// TEST: Int32Array vs plain properties vs local variables only

const matchNewFn_localVars = new Function(
  '$0',
  `
  var _r = { data: null, params: null };
  return function(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _r.data = $0;
          _r.params = 7;
          return _r;
        }
      }
    }
  };
  `,
)(data)

// ── Hypothesis 5: V8 optimization budget / warmup ───────────────
//
// new Function() code may need more iterations to get optimized.
// V8 uses invocation count + IC feedback to decide when to optimize.
// The inner function returned from new Function() starts fresh.
//
// TEST: pre-warm the function with many calls before benchmarking

// Pre-warm all generated functions
for (let i = 0; i < 100_000; i++) {
  matchNewFn('GET', '/users/123')
  matchNewFn('GET', '/missing')
  matchNewFn_argRef('GET', '/users/123')
  matchNewFn_noClose('GET', '/users/123')
  matchNewFn_plainObj('GET', '/users/123')
  matchNewFn_noParams('GET', '/users/123')
  matchNewFn_localVars('GET', '/users/123')
  matchInline('GET', '/users/123')
  matchInline('GET', '/missing')
}

// ── Hypothesis 6: eval() vs new Function() ──────────────────────
//
// eval() runs in the current scope and may get different optimization.
// Some engines optimize eval() differently from new Function().

const matchEval = eval(`
  (function() {
    var _r = { data: null, params: null };
    var _lp = {
      _p: '',
      _o: new Int32Array(2),
      get id() { return this._p.slice(this._o[0], this._o[1]); },
      toJSON() { var r = {}; for (var k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = this[k]; return r; },
    };
    var $data = data;
    return function matchEvalFn(m, p) {
      if (p.charCodeAt(1) === 117) {
        if (p.charCodeAt(6) === 47 || p.length === 6) {
          if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
            _lp._p = p;
            _lp._o[0] = 7;
            _lp._o[1] = p.length;
            _r.data = $data;
            _r.params = _lp;
            return _r;
          }
        }
      }
    };
  })()
`)

// Pre-warm eval version too
for (let i = 0; i < 100_000; i++) {
  matchEval('GET', '/users/123')
  matchEval('GET', '/missing')
}

console.log('eval:', matchEval('GET', path)?.params?.id)
console.log()

// ── Hypothesis 7: Function body size / switch bloat ─────────────
//
// The actual compiled router has a huge switch statement for statics
// BEFORE the param matching code. Large function bodies may prevent
// TurboFan from optimizing the whole function, or the switch may
// cause the param path to be in a "cold" branch.
//
// TEST: minimal new Function() (no switch) vs full-size

const matchNewFn_withSwitch = new Function(
  '$0', '$1', '$2', '$3',
  `
  var _r = { data: null, params: null };
  var _lp = {
    _p: '',
    _o: new Int32Array(2),
    get id() { return this._p.slice(this._o[0], this._o[1]); },
    toJSON() { var r = {}; for (var k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = this[k]; return r; },
  };
  return function(m, p) {
    switch(p) {
      case "/users": if(m==="GET"){_r.data=$0;_r.params=null;return _r;} break;
      case "/users/list": if(m==="GET"){_r.data=$1;_r.params=null;return _r;} break;
      case "/posts": if(m==="GET"){_r.data=$2;_r.params=null;return _r;} break;
      case "/posts/list": if(m==="GET"){_r.data=$3;_r.params=null;return _r;} break;
      case "/api/v1/health": if(m==="GET"){_r.data=$0;_r.params=null;return _r;} break;
      case "/api/v1/config": if(m==="GET"){_r.data=$1;_r.params=null;return _r;} break;
      case "/admin/dashboard": if(m==="GET"){_r.data=$2;_r.params=null;return _r;} break;
      case "/admin/settings": if(m==="GET"){_r.data=$3;_r.params=null;return _r;} break;
    }
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp._p = p;
          _lp._o[0] = 7;
          _lp._o[1] = p.length;
          _r.data = $0;
          _r.params = _lp;
          return _r;
        }
      }
    }
  };
  `,
)(data, data, data, data)

for (let i = 0; i < 100_000; i++) {
  matchNewFn_withSwitch('GET', '/users/123')
  matchNewFn_withSwitch('GET', '/missing')
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BENCHMARKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log('=== H1: inline vs new Function() (same logic) ===')
summary(() => {
  compact(() => {
    bench('H1a: inline function', () => matchInline('GET', path))
    bench('H1b: new Function()', () => matchNewFn('GET', path))
    bench('H1c: eval()', () => matchEval('GET', path))
  })
})

console.log()
console.log('=== H2: closure scope impact ===')
summary(() => {
  compact(() => {
    bench('H2a: new Function() w/ $0 arg ref', () => matchNewFn_argRef('GET', path))
    bench('H2b: new Function() no closure (data inside)', () => matchNewFn_noClose('GET', path))
    bench('H2c: inline (baseline)', () => matchInline('GET', path))
  })
})

console.log()
console.log('=== H3: lazy getter object vs plain object ===')
summary(() => {
  compact(() => {
    bench('H3a: new Function() w/ getter _lp', () => matchNewFn('GET', path))
    bench('H3b: new Function() w/ plain obj + slice', () => matchNewFn_plainObj('GET', path))
    bench('H3c: new Function() no params obj', () => matchNewFn_noParams('GET', path))
    bench('H3d: new Function() local vars only', () => matchNewFn_localVars('GET', path))
  })
})

console.log()
console.log('=== H7: function body size (switch bloat) ===')
summary(() => {
  compact(() => {
    bench('H7a: minimal new Function()', () => matchNewFn('GET', path))
    bench('H7b: new Function() + 8-case switch', () => matchNewFn_withSwitch('GET', path))
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BONUS: Test whether naming the function helps V8
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const matchNewFn_named = new Function(
  '$0',
  `
  var _r = { data: null, params: null };
  var _lp = {
    _p: '',
    _o: new Int32Array(2),
    get id() { return this._p.slice(this._o[0], this._o[1]); },
    toJSON() { var r = {}; for (var k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = this[k]; return r; },
  };
  return function katmanMatch(m, p) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp._p = p;
          _lp._o[0] = 7;
          _lp._o[1] = p.length;
          _r.data = $0;
          _r.params = _lp;
          return _r;
        }
      }
    }
  };
  `,
)(data)

for (let i = 0; i < 100_000; i++) matchNewFn_named('GET', '/users/123')

console.log()
console.log('=== BONUS: named vs anonymous generated function ===')
summary(() => {
  compact(() => {
    bench('anonymous new Function()', () => matchNewFn('GET', path))
    bench('named new Function()', () => matchNewFn_named('GET', path))
    bench('inline (baseline)', () => matchInline('GET', path))
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// CRITICAL TEST: Does the actual Katman compiler output
// match what we're testing here?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { createRouter, addRoute, compileRouter } from '../src/route/index.ts'

const kr = createRouter()
const paths = [
  '/users', '/users/list', '/posts', '/posts/list',
  '/api/v1/health', '/api/v1/config',
  '/admin/dashboard', '/admin/settings',
  '/users/:id', '/users/:id/posts', '/users/:id/posts/:postId',
  '/api/v1/:resource', '/api/v1/:resource/:id',
  '/files/**', '/assets/**', '/cdn/**:path',
]
for (const p of paths) addRoute(kr, 'GET', p, { path: p })
const kc = compileRouter(kr)

for (let i = 0; i < 100_000; i++) {
  kc('GET', '/users/123')
  kc('GET', '/missing')
}

console.log()
console.log('=== ACTUAL KATMAN vs isolated new Function() ===')
summary(() => {
  compact(() => {
    bench('katman compileRouter (actual)', () => kc('GET', '/users/123'))
    bench('new Function() (isolated, same logic)', () => matchNewFn('GET', path))
    bench('inline (baseline)', () => matchInline('GET', path))
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// ALTERNATIVE APPROACH: Don't use new Function() at all.
// Build a closure chain instead.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Approach A: Closure-based "compiler" — no eval, no new Function
function buildMatcher(routeData: any) {
  const _r = { data: null as any, params: null as any }
  const _lp = {
    _p: '',
    _o: new Int32Array(2),
    get id() { return this._p.slice(this._o[0]!, this._o[1]!) },
    toJSON() { const r: any = {}; for (const k in this) if (k[0] !== '_' && k !== 'toJSON') r[k] = (this as any)[k]; return r },
  }
  const d = routeData

  return function closureMatcher(m: string, p: string) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _lp._p = p
          _lp._o[0] = 7
          _lp._o[1] = p.length
          _r.data = d
          _r.params = _lp
          return _r
        }
      }
    }
  }
}

const matchClosure = buildMatcher(data)
for (let i = 0; i < 100_000; i++) matchClosure('GET', '/users/123')

// Approach B: Closure with NO getter — store offset only, consumer extracts
function buildMatcherNoGetter(routeData: any) {
  const _r = { data: null as any, params: null as any, _p: '', _s: 0, _e: 0 }
  const d = routeData

  return function closureNoGetter(m: string, p: string) {
    if (p.charCodeAt(1) === 117) {
      if (p.charCodeAt(6) === 47 || p.length === 6) {
        if (m === 'GET' && p.indexOf('/', 7) === -1 && p.length > 7) {
          _r._p = p
          _r._s = 7
          _r._e = p.length
          _r.data = d
          _r.params = null // consumer uses _r._p.slice(_r._s, _r._e)
          return _r
        }
      }
    }
  }
}

const matchClosureNoGetter = buildMatcherNoGetter(data)
for (let i = 0; i < 100_000; i++) matchClosureNoGetter('GET', '/users/123')

// Approach C: Table-driven — no code generation at all
// Store route metadata in arrays, use a tight loop
interface RouteEntry {
  charCode1: number
  prefixEnd: number    // position of '/' after prefix
  paramStart: number
  data: any
}

const routeTable: RouteEntry[] = [
  { charCode1: 117, prefixEnd: 6, paramStart: 7, data },
]

const _r_table = { data: null as any, params: null as any }

function tableMatcher(m: string, p: string) {
  const c1 = p.charCodeAt(1)
  for (let i = 0; i < routeTable.length; i++) {
    const r = routeTable[i]!
    if (c1 === r.charCode1 && (p.charCodeAt(r.prefixEnd) === 47 || p.length === r.prefixEnd)) {
      if (m === 'GET' && p.indexOf('/', r.paramStart) === -1 && p.length > r.paramStart) {
        _r_table.data = r.data
        _r_table.params = r.paramStart // consumer does p.slice(params)
        return _r_table
      }
    }
  }
}

for (let i = 0; i < 100_000; i++) tableMatcher('GET', '/users/123')

console.log()
console.log('=== ALTERNATIVE APPROACHES (no new Function) ===')
summary(() => {
  compact(() => {
    bench('closure-based (with getter)', () => matchClosure('GET', path))
    bench('closure-based (no getter)', () => matchClosureNoGetter('GET', path))
    bench('table-driven loop', () => tableMatcher('GET', path))
    bench('new Function() (comparison)', () => matchNewFn('GET', path))
    bench('inline (baseline)', () => matchInline('GET', path))
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DEEP INVESTIGATION: Is mitata measuring correctly?
// Do a manual timing loop as cross-check.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log()
console.log('=== MANUAL TIMING CROSS-CHECK ===')
const ITERATIONS = 10_000_000
let sink: any

function manualTime(label: string, fn: () => any) {
  // Warm up
  for (let i = 0; i < 100_000; i++) sink = fn()

  const start = performance.now()
  for (let i = 0; i < ITERATIONS; i++) sink = fn()
  const elapsed = performance.now() - start
  const nsPerOp = (elapsed * 1_000_000) / ITERATIONS
  console.log(`  ${label}: ${nsPerOp.toFixed(1)}ns/op`)
}

manualTime('inline', () => matchInline('GET', path))
manualTime('new Function()', () => matchNewFn('GET', path))
manualTime('new Function() plain obj', () => matchNewFn_plainObj('GET', path))
manualTime('new Function() local vars', () => matchNewFn_localVars('GET', path))
manualTime('new Function() no closure', () => matchNewFn_noClose('GET', path))
manualTime('closure-based', () => matchClosure('GET', path))
manualTime('closure no getter', () => matchClosureNoGetter('GET', path))
manualTime('eval()', () => matchEval('GET', path))
manualTime('katman actual', () => kc('GET', '/users/123'))

await run()
