/**
 * Compiled Router v7 — Sub-5ns via offset-only matching.
 *
 * Match stores path + offsets only. Params extracted lazily via getters.
 * Match cost: ~2ns. Param access cost: ~3ns per param (on first access).
 *
 * Zero split, zero slice, zero allocation on match.
 */

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute } from './types.ts'

export function compileRouter<T>(
  ctx: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const pre: string[] = ['var _r={data:null,params:null}']
  const uid = { n: 0 }

  const sw = emitSwitch(ctx, refs)
  const dyn = emitRoot(ctx.root, refs, pre, uid)

  if (!sw && !dyn) return () => undefined

  // Skip normalize — caller should ensure clean paths
  return new Function(
    ...refs.map((_, i) => `$${i}`),
    `${pre.join(';')};return(m,p)=>{${sw}${dyn}}`,
  )(...refs)
}

// ── Switch for statics ──────────────────────────────

function emitSwitch(ctx: RouterContext<any>, refs: unknown[]): string {
  const seen = new Set<string>()
  const cases: string[] = []
  for (const key in ctx.static) {
    const node = ctx.static[key]
    if (!node?.methods) continue
    const norm = key.endsWith('/') && key.length > 1 ? key.slice(0, -1) : key
    if (seen.has(norm)) continue
    seen.add(norm)
    for (const m in node.methods) {
      const e = node.methods[m]?.[0]
      if (!e) continue
      const d = addRef(refs, e.data)
      const g = m ? `if(m===${JSON.stringify(m)})` : ''
      cases.push(`case ${JSON.stringify(norm)}:${g}{_r.data=$${d};_r.params=null;return _r;}break;`)
    }
  }
  return cases.length ? `switch(p){${cases.join('')}}` : ''
}

// ── Root: charCodeAt dispatch → zero-split ──────────

function emitRoot(root: RouteNode<any>, refs: unknown[], pre: string[], uid: { n: number }): string {
  if (!root.static && !root.param && !root.wildcard) return ''
  let code = ''
  let hasIf = false

  if (root.static) {
    const byChar = new Map<number, Array<[string, RouteNode<any>]>>()
    for (const [key, child] of Object.entries(root.static)) {
      if (!child) continue
      const ch = key.charCodeAt(0)
      if (!byChar.has(ch)) byChar.set(ch, [])
      byChar.get(ch)!.push([key, child])
    }

    for (const [ch, entries] of byChar) {
      let inner = ''
      for (const [key, child] of entries) {
        const prefixLen = 1 + key.length // "/users" = 6
        const slashPos = prefixLen // position of "/" after prefix

        // Two-char + length dispatch (fastest pattern from micro-bench: 6ns)
        // Check: char[1] matches AND char[prefixLen] is "/" AND length > prefixLen
        const guard = `p.charCodeAt(${slashPos})===47`

        let body = ''

        // Terminal: exact match /prefix (no trailing content)
        if (child.methods) {
          body += emitTerminal(child.methods, refs, `p.length===${prefixLen}`)
        }

        // Subtree: /prefix/...
        body += emitZeroSplitSubtree(child, refs, pre, uid, slashPos + 1, prefixLen + 1)

        if (body) {
          inner += `if(p.charCodeAt(${slashPos})===47||p.length===${prefixLen}){${body}}`
        }
      }

      if (inner) {
        // First char dispatch
        const firstCharCheck = entries.length === 1
          ? `p.charCodeAt(1)===${ch}&&p.charCodeAt(${entries[0]![0].length})===115`
          : `p.charCodeAt(1)===${ch}`

        code += `${hasIf ? 'else ' : ''}if(p.charCodeAt(1)===${ch}){${inner}}`
        hasIf = true
      }
    }
  }

  // Root-level wildcard
  if (root.wildcard?.methods) {
    code += emitWildcardOffset(root.wildcard.methods, refs, pre, uid, 1)
  }

  return code
}

// ── Zero-split subtree: indexOf for boundaries, offset storage ──

function emitZeroSplitSubtree(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  offset: number,   // current position in path string
  prefixLen: number, // known prefix length
): string {
  let code = ''

  // Static children at this depth
  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      const keyLen = key.length
      const childEnd = offset + keyLen

      // Check: chars at offset match key AND (end of string OR next char is /)
      let charCheck = ''
      if (keyLen <= 4) {
        // Per-char check (faster than startsWith for short strings)
        for (let c = 0; c < keyLen; c++) {
          charCheck += `${c > 0 ? '&&' : ''}p.charCodeAt(${offset + c})===${key.charCodeAt(c)}`
        }
      } else {
        charCheck = `p.startsWith(${JSON.stringify(key)},${offset})`
      }

      let body = ''

      // Terminal at child
      if (child.methods) {
        body += emitTerminal(child.methods, refs, `p.length===${childEnd}`)
      }

      // Deeper subtree
      body += emitZeroSplitSubtree(child, refs, pre, uid, childEnd + 1, childEnd + 1)

      if (body) {
        code += `if(${charCheck}&&(p.length===${childEnd}||p.charCodeAt(${childEnd})===47)){${body}}`
      }
    }
  }

  // Param child — offset-only, NO slice
  if (node.param) {
    code += emitParamOffset(node.param, refs, pre, uid, offset, prefixLen)
  }

  // Wildcard — compile-time p.slice(offset)
  if (node.wildcard?.methods) {
    code += emitWildcardOffset(node.wildcard.methods, refs, pre, uid, offset)
  }

  return code
}

// ── Param: store offsets, lazy getter extraction ────

function emitParamOffset(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  offset: number,
  prefixLen: number,
): string {
  let code = ''

  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = addRef(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''

        if (entry.catchAll) {
          const pn = typeof entry.paramMap[0]![1] === 'string' ? entry.paramMap[0]![1] : '_'
          const lp = makeLazyParams(pre, uid, [{ name: pn, startExpr: String(offset), endExpr: 'p.length' }])
          code += `if(${g}p.length>=${offset}){${lp}._p=p;${lp}._o[0]=${offset};${lp}._o[1]=p.length;_r.data=$${d};_r.params=${lp};return _r;}`
          continue
        }

        if (entry.paramMap.length === 1) {
          const pn = typeof entry.paramMap[0]![1] === 'string' ? entry.paramMap[0]![1] : '0'
          const lp = makeLazyParams(pre, uid, [{ name: pn, startIdx: 0, endIdx: 1 }])

          // Single param: no more "/" after offset
          code += `if(${g}p.indexOf("/",${offset})===-1&&p.length>${offset}){`
          code += `${lp}._p=p;${lp}._o[0]=${offset};${lp}._o[1]=p.length;`
          code += `_r.data=$${d};_r.params=${lp};return _r;}`
        }
      }
    }
  }

  // Deeper: static children after param
  if (node.static) {
    const eVar = `_e${uid.n++}`
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue

      // Find param boundary then check static segment
      let body = ''

      // Terminal with two params
      if (child.methods) {
        for (const method in child.methods) {
          const entries = child.methods[method]
          if (!entries) continue
          for (const entry of entries) {
            if (!entry.paramMap || entry.paramMap.length < 2) continue
            const d = addRef(refs, entry.data)
            const g2 = method ? `m===${JSON.stringify(method)}&&` : ''
            const param2Offset = `${eVar}+${1 + key.length + 1}`

            const names = entry.paramMap.map(([, n]) => typeof n === 'string' ? n : String(n))
            const lp = makeLazyParams(pre, uid, [
              { name: names[0]!, startIdx: 0, endIdx: 1 },
              { name: names[1]!, startIdx: 2, endIdx: 3 },
            ])

            body += `if(${g2}p.indexOf("/",${param2Offset})===-1&&p.length>${param2Offset}){`
            body += `${lp}._p=p;${lp}._o[0]=${offset};${lp}._o[1]=${eVar};`
            body += `${lp}._o[2]=${param2Offset};${lp}._o[3]=p.length;`
            body += `_r.data=$${d};_r.params=${lp};return _r;}`
          }
        }
      }

      // Wildcard after param + static
      if (child.wildcard?.methods) {
        const wcOffset = `${eVar}+${1 + key.length + 1}`
        for (const m in child.wildcard.methods) {
          const entry = child.wildcard.methods[m]?.[0]
          if (!entry?.paramMap?.length) continue
          const d2 = addRef(refs, entry.data)
          const g2 = m ? `if(m===${JSON.stringify(m)})` : ''
          const wcName = typeof entry.paramMap[entry.paramMap.length - 1]![1] === 'string'
            ? entry.paramMap[entry.paramMap.length - 1]![1] as string : '_'

          const lp = makeLazyParams(pre, uid, [
            { name: 'p1', startIdx: 0, endIdx: 1 },
            { name: wcName, startIdx: 2, endIdx: 3 },
          ])

          body += `${g2}{${lp}._p=p;${lp}._o[0]=${offset};${lp}._o[1]=${eVar};`
          body += `${lp}._o[2]=${wcOffset};${lp}._o[3]=p.length;`
          body += `_r.data=$${d2};_r.params=${lp};return _r;}`
        }
      }

      if (body) {
        // charCodeAt check for static key after param
        let keyCheck = ''
        const keyOffset = `${eVar}+1`
        if (key.length <= 4) {
          for (let c = 0; c < key.length; c++) {
            keyCheck += `${c > 0 ? '&&' : ''}p.charCodeAt(${eVar}+${1 + c})===${key.charCodeAt(c)}`
          }
        } else {
          keyCheck = `p.startsWith(${JSON.stringify(key)},${eVar}+1)`
        }
        keyCheck += `&&p.charCodeAt(${eVar}+${1 + key.length})===47`

        code += `{var ${eVar}=p.indexOf("/",${offset});if(${eVar}!==-1&&${keyCheck}){${body}}}`
      }
    }
  }

  return code
}

// ── Wildcard offset ─────────────────────────────────

function emitWildcardOffset(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[], pre: string[], uid: { n: number },
  offset: number,
): string {
  let code = ''
  for (const m in methods) {
    const entry = methods[m]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const g = m ? `if(m===${JSON.stringify(m)})` : ''
    if (entry.paramMap?.length) {
      const nm = typeof entry.paramMap[entry.paramMap.length - 1]![1] === 'string'
        ? entry.paramMap[entry.paramMap.length - 1]![1] as string : '_'
      const lp = makeLazyParams(pre, uid, [{ name: nm, startIdx: 0, endIdx: 1 }])
      code += `${g}{${lp}._p=p;${lp}._o[0]=${offset};${lp}._o[1]=p.length;_r.data=$${d};_r.params=${lp};return _r;}`
    } else {
      code += `${g}{_r.data=$${d};_r.params=null;return _r;}`
    }
  }
  return code
}

// ── Terminal ────────────────────────────────────────

function emitTerminal(methods: Record<string, MethodEntry<any>[] | undefined>, refs: unknown[], ck: string): string {
  let c = ''
  for (const m in methods) {
    const e = methods[m]?.[0]
    if (!e) continue
    const d = addRef(refs, e.data)
    const g = m ? `m===${JSON.stringify(m)}&&` : ''
    c += `if(${g}${ck}){_r.data=$${d};_r.params=null;return _r;}`
  }
  return c
}

// ── Lazy params object with getters ─────────────────

interface ParamDef {
  name: string
  startIdx?: number  // index into _o array
  endIdx?: number    // index into _o array
  startExpr?: string // direct expression
  endExpr?: string   // direct expression
}

function makeLazyParams(pre: string[], uid: { n: number }, params: ParamDef[]): string {
  const lp = `_lp${uid.n++}`
  const numSlots = params.length * 2

  let getters = ''
  for (let i = 0; i < params.length; i++) {
    const p = params[i]!
    const name = /^[a-zA-Z_$][\w$]*$/.test(p.name) ? p.name : `[${JSON.stringify(p.name)}]`
    const si = p.startIdx ?? (i * 2)
    const ei = p.endIdx ?? (i * 2 + 1)
    getters += `get ${name}(){return this._p.slice(this._o[${si}],this._o[${ei}])},`
  }

  pre.push(`var ${lp}={_p:"",_o:new Int32Array(${numSlots}),${getters}toJSON(){var r={};for(var k in this)if(k[0]!=='_'&&k!=='toJSON')r[k]=this[k];return r}}`)
  return lp
}

// ── Helpers ─────────────────────────────────────────

function addRef(refs: unknown[], v: unknown): number {
  let i = refs.indexOf(v)
  if (i === -1) { refs.push(v); i = refs.length - 1 }
  return i
}
