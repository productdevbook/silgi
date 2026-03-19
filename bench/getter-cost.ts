/**
 * Isolate the exact cost of getter-based lazy params.
 *
 * Key finding from new-fn-gap.ts:
 *   - new Function() itself is NOT slower (14.8ns vs 14.8ns inline)
 *   - The getter on _lp costs ~8ns (14.8ns with getter vs 6.2ns without)
 *   - The p.slice() in the plain object path costs ~5ns (11.4ns vs 6.2ns)
 *
 * This benchmark isolates exactly what is expensive about the getter pattern
 * and tests alternatives that maintain the same API.
 *
 * Run: node --experimental-strip-types bench/getter-cost.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123'
const data = { handler: true }

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test 1: What EXACTLY about the getter is slow?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// A: Object with getter defined inline
const lpGetter = {
  _p: '',
  _o: new Int32Array(2),
  get id() { return this._p.slice(this._o[0]!, this._o[1]!) },
}
const rGetter = { data: null as any, params: null as any }

function matchGetter(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpGetter._p = p
    lpGetter._o[0] = 7
    lpGetter._o[1] = p.length
    rGetter.data = data
    rGetter.params = lpGetter
    return rGetter
  }
}

// B: Object with getter defined via Object.defineProperty
const lpDefProp: any = { _p: '', _o: new Int32Array(2) }
Object.defineProperty(lpDefProp, 'id', {
  get() { return this._p.slice(this._o[0], this._o[1]) },
  enumerable: true,
})
const rDefProp = { data: null as any, params: null as any }

function matchDefProp(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpDefProp._p = p
    lpDefProp._o[0] = 7
    lpDefProp._o[1] = p.length
    rDefProp.data = data
    rDefProp.params = lpDefProp
    return rDefProp
  }
}

// C: Plain object, store offset integers (no getter, no slice)
const lpPlainOffset = { _p: '', s: 0, e: 0 }
const rPlainOffset = { data: null as any, params: lpPlainOffset }

function matchPlainOffset(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpPlainOffset._p = p
    lpPlainOffset.s = 7
    lpPlainOffset.e = p.length
    rPlainOffset.data = data
    return rPlainOffset
  }
}

// D: Plain object with eager slice
const lpEagerSlice = { id: '' }
const rEagerSlice = { data: null as any, params: lpEagerSlice }

function matchEagerSlice(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpEagerSlice.id = p.slice(7)
    rEagerSlice.data = data
    return rEagerSlice
  }
}

// E: Return offsets in the result object itself (flat)
const rFlat = { data: null as any, params: null as any, _s: 0, _e: 0 }

function matchFlat(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    rFlat.data = data
    rFlat.params = p as any // store the path string as params
    rFlat._s = 7
    rFlat._e = p.length
    return rFlat
  }
}

// F: Store only the start offset as params (number), consumer computes
const rOffsetOnly = { data: null as any, params: 0 }

function matchOffsetOnly(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    rOffsetOnly.data = data
    rOffsetOnly.params = 7
    return rOffsetOnly
  }
}

// G: Bare minimum — just set data on pre-allocated result
const rBare = { data: null as any, params: null as any }

function matchBare(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    rBare.data = data
    return rBare
  }
}

// H: Object with getter but NO Int32Array — use plain number properties
const lpGetterNoTA = {
  _p: '',
  _s: 0,
  _e: 0,
  get id() { return this._p.slice(this._s, this._e) },
}
const rGetterNoTA = { data: null as any, params: null as any }

function matchGetterNoTA(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpGetterNoTA._p = p
    lpGetterNoTA._s = 7
    lpGetterNoTA._e = p.length
    rGetterNoTA.data = data
    rGetterNoTA.params = lpGetterNoTA
    return rGetterNoTA
  }
}

// I: Getter but DON'T assign params — just set _lp fields
const lpGetterOnly = {
  _p: '',
  _o: new Int32Array(2),
  get id() { return this._p.slice(this._o[0]!, this._o[1]!) },
}
const rGetterOnly = { data: null as any, params: lpGetterOnly }

function matchGetterNoAssign(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpGetterOnly._p = p
    lpGetterOnly._o[0] = 7
    lpGetterOnly._o[1] = p.length
    rGetterOnly.data = data
    // DON'T assign rGetterOnly.params = lpGetterOnly (it's already set)
    return rGetterOnly
  }
}

// Warm up all
for (let i = 0; i < 100_000; i++) {
  matchGetter(path)
  matchDefProp(path)
  matchPlainOffset(path)
  matchEagerSlice(path)
  matchFlat(path)
  matchOffsetOnly(path)
  matchBare(path)
  matchGetterNoTA(path)
  matchGetterNoAssign(path)
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Benchmark: Isolate the cost layers
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log('=== COST LAYERS (each adds one thing) ===')
summary(() => {
  compact(() => {
    bench('bare: charCodeAt+indexOf+data (floor)', () => matchBare(path))
    bench('+ offset as params (number)', () => matchOffsetOnly(path))
    bench('+ flat offsets on result obj', () => matchFlat(path))
    bench('+ plain offset obj (3 props)', () => matchPlainOffset(path))
    bench('+ eager p.slice(7)', () => matchEagerSlice(path))
    bench('+ getter (no Int32Array)', () => matchGetterNoTA(path))
    bench('+ getter (Int32Array)', () => matchGetter(path))
    bench('+ getter (Int32Array, pre-assigned)', () => matchGetterNoAssign(path))
    bench('+ getter (defineProperty)', () => matchDefProp(path))
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test 2: Is `rGetter.params = lpGetter` the problem?
// When you write an object with accessors to a property,
// V8 may need to update the hidden class of the parent.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const plainObj = { id: 'test' }
const getterObj = { get id() { return 'test' } }
const target = { data: null as any, params: null as any }

console.log()
console.log('=== ASSIGNMENT COST: plain vs getter object ===')
summary(() => {
  compact(() => {
    bench('target.params = plainObj', () => { target.params = plainObj })
    bench('target.params = getterObj', () => { target.params = getterObj as any })
    bench('target.params = null', () => { target.params = null })
    bench('target.params = 7 (number)', () => { target.params = 7 as any })
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test 3: Int32Array write cost
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const i32 = new Int32Array(4)
const plainNums = { a: 0, b: 0 }
let x = 0, y = 0

console.log()
console.log('=== INT32ARRAY vs PLAIN PROPERTY vs LOCAL ===')
summary(() => {
  compact(() => {
    bench('Int32Array[0]=7, [1]=10', () => { i32[0] = 7; i32[1] = 10 })
    bench('obj.a=7, obj.b=10', () => { plainNums.a = 7; plainNums.b = 10 })
    bench('x=7, y=10 (locals)', () => { x = 7; y = 10 })
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test 4: Does the COMBINATION of getter + Int32Array +
// string property on the SAME object cause V8 to bail?
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Minimal: just the writes, no matching logic
const lpMin = {
  _p: '',
  _o: new Int32Array(2),
  get id() { return this._p.slice(this._o[0]!, this._o[1]!) },
}
const rMin = { data: null as any, params: null as any }

console.log()
console.log('=== ISOLATED WRITE COST: getter object fields ===')
summary(() => {
  compact(() => {
    bench('_p=str, _o[0]=7, _o[1]=10, assign params', () => {
      lpMin._p = path
      lpMin._o[0] = 7
      lpMin._o[1] = 10
      rMin.data = data
      rMin.params = lpMin
    })
    bench('same but DON\'T assign params', () => {
      lpMin._p = path
      lpMin._o[0] = 7
      lpMin._o[1] = 10
      rMin.data = data
    })
    bench('only _p + data (no offsets)', () => {
      lpMin._p = path
      rMin.data = data
      rMin.params = lpMin
    })
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test 5: Proxy-based lazy params vs getter
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Alternative: use a class with hidden fields
class LazyParams {
  _p = ''
  _s = 0
  _e = 0
  get id() { return this._p.slice(this._s, this._e) }
}

const lpClass = new LazyParams()
const rClass = { data: null as any, params: lpClass }

function matchClass(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    lpClass._p = p
    lpClass._s = 7
    lpClass._e = p.length
    rClass.data = data
    return rClass
  }
}

for (let i = 0; i < 100_000; i++) matchClass(path)

console.log()
console.log('=== CLASS-BASED vs LITERAL GETTER vs PLAIN ===')
summary(() => {
  compact(() => {
    bench('class LazyParams (getter)', () => matchClass(path))
    bench('literal getter (inline obj)', () => matchGetterNoTA(path))
    bench('literal getter (Int32Array)', () => matchGetter(path))
    bench('plain offset obj (no getter)', () => matchPlainOffset(path))
    bench('eager slice', () => matchEagerSlice(path))
    bench('bare (floor)', () => matchBare(path))
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test 6: The nuclear option — match returns a function
// that extracts params when called. Zero work during match.
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const rFn = { data: null as any, params: null as (() => Record<string, string>) | null }

function matchReturnFn(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    rFn.data = data
    // Capture the path and offset in a closure — but ONLY create the closure,
    // don't do any slicing. The closure is cheap if V8 inlines it.
    const s = 7
    rFn.params = () => ({ id: p.slice(s) })
    return rFn
  }
}

for (let i = 0; i < 100_000; i++) matchReturnFn(path)

// Also test: pre-allocated closure (avoid closure allocation per call)
let _capP = ''
let _capS = 0
const extractFn = () => ({ id: _capP.slice(_capS) })
const rFn2 = { data: null as any, params: extractFn }

function matchReuseClosure(p: string) {
  if (p.charCodeAt(1) === 117 && p.indexOf('/', 7) === -1 && p.length > 7) {
    _capP = p
    _capS = 7
    rFn2.data = data
    return rFn2
  }
}

for (let i = 0; i < 100_000; i++) matchReuseClosure(path)

console.log()
console.log('=== CLOSURE-BASED LAZY PARAMS ===')
summary(() => {
  compact(() => {
    bench('new closure per match', () => matchReturnFn(path))
    bench('reuse closure (module vars)', () => matchReuseClosure(path))
    bench('getter obj (current)', () => matchGetter(path))
    bench('bare (floor)', () => matchBare(path))
  })
})

await run()
