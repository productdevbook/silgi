/**
 * Inline vs new Function() — why 14x slower?
 *
 * Run: node --experimental-strip-types bench/inline-vs-generated.ts
 */

import { bench, run, summary, compact } from 'mitata'

const path = '/users/123'
const data = { handler: true }

// ── Pre-allocated objects (shared) ──────────────────
const _r = { data: null as any, params: null as any }
const _p = { _p: '', _o: new Int32Array(2), get id() { return this._p.slice(this._o[0], this._o[1]) } }

// ── 1. Inline function (1.6ns in micro-bench) ───────
function inlineMatch(m: string, p: string) {
  if (p.charCodeAt(1) === 117 && p.charCodeAt(6) === 47 && p.length > 7 && p.indexOf('/', 7) === -1) {
    _p._p = p; _p._o[0] = 7; _p._o[1] = p.length
    _r.data = data; _r.params = _p; return _r
  }
}

// ── 2. new Function() — same logic ──────────────────
const generatedMatch = new Function('data', '_r', '_p',
  `return function(m,p){
    if(p.charCodeAt(1)===117&&p.charCodeAt(6)===47&&p.length>7&&p.indexOf("/",7)===-1){
      _p._p=p;_p._o[0]=7;_p._o[1]=p.length;
      _r.data=data;_r.params=_p;return _r;
    }
  }`
)(data, _r, _p)

// ── 3. new Function() with closure refs ($0 style) ──
const generatedClosure = new Function('$0',
  `var _r={data:null,params:null};
   var _p={_p:"",_o:new Int32Array(2),get id(){return this._p.slice(this._o[0],this._o[1])}};
   return function(m,p){
    if(p.charCodeAt(1)===117&&p.charCodeAt(6)===47&&p.length>7&&p.indexOf("/",7)===-1){
      _p._p=p;_p._o[0]=7;_p._o[1]=p.length;
      _r.data=$0;_r.params=_p;return _r;
    }
  }`
)(data)

// ── 4. new Function() — direct return (no pre-alloc) ──
const generatedDirect = new Function('$0',
  `return function(m,p){
    if(p.charCodeAt(1)===117&&p.charCodeAt(6)===47&&p.length>7&&p.indexOf("/",7)===-1){
      return{data:$0,params:{id:p.slice(7)}};
    }
  }`
)(data)

// ── 5. eval() instead of new Function() ─────────────
const evalMatch = eval(`(function(data){
  var _r={data:null,params:null};
  var _p={_p:"",_o:new Int32Array(2),get id(){return this._p.slice(this._o[0],this._o[1])}};
  return function(m,p){
    if(p.charCodeAt(1)===117&&p.charCodeAt(6)===47&&p.length>7&&p.indexOf("/",7)===-1){
      _p._p=p;_p._o[0]=7;_p._o[1]=p.length;
      _r.data=data;_r.params=_p;return _r;
    }
  }
})`)(data)

// ── 6. Arrow function via new Function ──────────────
const generatedArrow = new Function('$0',
  `var _r={data:null,params:null};
   var _p={_p:"",_o:new Int32Array(2),get id(){return this._p.slice(this._o[0],this._o[1])}};
   return(m,p)=>{
    if(p.charCodeAt(1)===117&&p.charCodeAt(6)===47&&p.length>7&&p.indexOf("/",7)===-1){
      _p._p=p;_p._o[0]=7;_p._o[1]=p.length;
      _r.data=$0;_r.params=_p;return _r;
    }
  }`
)(data)

// ── 7. Warmup then benchmark ────────────────────────
// Pre-warm all functions to ensure TurboFan compilation
for (let i = 0; i < 10000; i++) {
  inlineMatch('GET', path)
  generatedMatch('GET', path)
  generatedClosure('GET', path)
  generatedDirect('GET', path)
  evalMatch('GET', path)
  generatedArrow('GET', path)
}

// Verify all return same structure
console.log('inline:', inlineMatch('GET', path)?.data === data)
console.log('generated:', generatedMatch('GET', path)?.data === data)
console.log('closure:', generatedClosure('GET', path)?.data === data)
console.log('direct:', generatedDirect('GET', path)?.data === data)
console.log('eval:', evalMatch('GET', path)?.data === data)
console.log('arrow:', generatedArrow('GET', path)?.data === data)
console.log()

summary(() => {
  compact(() => {
    bench('1. inline function', () => inlineMatch('GET', path))
    bench('2. new Function (shared refs)', () => generatedMatch('GET', path))
    bench('3. new Function (closure $0)', () => generatedClosure('GET', path))
    bench('4. new Function (direct return)', () => generatedDirect('GET', path))
    bench('5. eval()', () => evalMatch('GET', path))
    bench('6. new Function (arrow)', () => generatedArrow('GET', path))
  })
})

await run()
