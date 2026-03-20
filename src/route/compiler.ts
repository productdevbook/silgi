/**
 * Compiled Router — JIT compiler with recursive tree traversal.
 *
 * Architecture:
 * 1. switch(p) for static routes — O(1)
 * 2. charCodeAt(1) dispatch per first-char group — fast miss
 * 3. Branch functions with split — handles ALL tree patterns recursively
 * 4. Pre-allocated per-route result objects — zero allocation
 * 5. Compile-time p.slice(N) for wildcards — no split+join
 *
 * Single recursive emitNode handles every pattern:
 * static segments, params, wildcards, regex, mixed depth.
 */

import { findRoute } from './find.ts'

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute } from './types.ts'

export function compileRouter<T>(
  ctx: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const pre: string[] = ['var _rs={data:null,params:null}']
  const uid = { n: 0 }

  const sw = emitSwitch(ctx, refs)
  const tree = emitTree(ctx.root, refs, pre, uid, 1)

  if (!sw && !tree) return () => undefined

  // Each first-char group gets its own branch function
  let branchDefs = ''
  let dispatch = ''

  if (ctx.root.static) {
    const byChar = new Map<number, Array<[string, RouteNode<any>]>>()
    for (const [key, child] of Object.entries(ctx.root.static)) {
      if (!child) continue
      const ch = key.charCodeAt(0)
      if (!byChar.has(ch)) byChar.set(ch, [])
      byChar.get(ch)!.push([key, child])
    }

    if (byChar.size > 0) dispatch += 'var c=p.charCodeAt(1);'

    let hasIf = false
    for (const [ch, entries] of byChar) {
      // Branch body: split once, then recursive tree match
      let body = 'var s=p.split("/"),l=s.length;'
      let innerIf = false
      for (const [key, child] of entries) {
        const childPrefix = 1 + key.length + 1 // "/key/" length
        const nodeCode = emitNode(child, refs, pre, uid, 2, childPrefix)
        if (!nodeCode) continue
        body += `${innerIf ? 'else ' : ''}if(s[1]===${JSON.stringify(key)}){${nodeCode}}`
        innerIf = true
      }

      if (innerIf) {
        const bn = `_b${uid.n++}`
        branchDefs += `var ${bn}=function(m,p){${body}};`
        dispatch += `${hasIf ? 'else ' : ''}if(c===${ch}){var _t=${bn}(m,p);if(_t)return _t}`
        hasIf = true
      }
    }
  }

  // Root-level param
  if (ctx.root.param) {
    const paramCode = emitParamNode(ctx.root.param, refs, pre, uid, 1)
    if (paramCode) {
      const bn = `_b${uid.n++}`
      branchDefs += `var ${bn}=function(m,p){var s=p.split("/"),l=s.length;${paramCode}};`
      dispatch += `{var _t=${bn}(m,p);if(_t)return _t}`
    }
  }

  // Root-level wildcard
  if (ctx.root.wildcard?.methods) {
    dispatch += emitWildcardSlice(ctx.root.wildcard.methods, refs, pre, uid, 1)
  }

  const code = `${pre.join(';')};${branchDefs}return(m,p)=>{if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);${sw}${dispatch}}`
  return new Function(...refs.map((_, i) => `$${i}`), code)(...refs)
}

// ── Switch for static routes ────────────────────────

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
      cases.push(`case ${JSON.stringify(norm)}:`)
      if (norm.length > 1) cases.push(`case ${JSON.stringify(norm + '/')}:`)
      cases.push(`${g}{_rs.data=$${d};return _rs}break;`)
    }
  }
  return cases.length ? `switch(p){${cases.join('')}}` : ''
}

// ── Recursive tree node emission ────────────────────
// This single function handles ALL patterns: static, param, wildcard,
// regex, mixed depth, nested params — using split-based s[depth] access.

function emitNode(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
  prefixLen?: number, // known string offset — undefined after param
): string {
  let code = ''

  // Terminal: this node has handlers
  if (node.methods) {
    // Check if any handler has params — if so, use param-aware terminal
    let hasParams = false
    for (const m in node.methods) {
      if (node.methods[m]?.some((e: MethodEntry<any>) => e.paramMap?.length)) { hasParams = true; break }
    }
    if (hasParams) {
      code += emitParamTerminal(node.methods, refs, pre, uid, depth)
    } else {
      code += emitTerminal(node.methods, refs, `l===${depth}`)
    }
  }

  let hasIf = false

  // Static children: s[depth] === "key"
  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      const childPrefix = prefixLen !== undefined ? prefixLen + key.length + 1 : undefined
      const inner = emitNode(child, refs, pre, uid, depth + 1, childPrefix)
      if (!inner) continue
      code += `${hasIf ? 'else ' : ''}if(s[${depth}]===${JSON.stringify(key)}){${inner}}`
      hasIf = true
    }
  }

  // Param child: prefixLen becomes unknown
  if (node.param) {
    code += emitParamNode(node.param, refs, pre, uid, depth)
  }

  // Wildcard: use p.slice(prefixLen) when known, s.slice(depth).join("/") otherwise
  if (node.wildcard?.methods) {
    if (prefixLen !== undefined) {
      code += emitWildcardSlice(node.wildcard.methods, refs, pre, uid, prefixLen)
    } else {
      code += emitWildcardSplit(node.wildcard.methods, refs, pre, uid, depth)
    }
  }

  return code
}

// ── Param node ──────────────────────────────────────

function emitParamNode(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
): string {
  let code = ''

  // Terminal: param handlers
  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = addRef(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''
        const { po, ro } = allocP(pre, uid, entry.paramMap)

        if (entry.catchAll) {
          // Catch-all: join remaining segments
          const pn = pmName(entry.paramMap[0]!)
          code += `if(${g}l>=${depth + 1}){${po}${safe(pn)}=s.slice(${depth}).join("/");${ro}.data=$${d};return ${ro}}`
          continue
        }

        const pc = entry.paramMap.length
        const lastOpt = entry.paramMap[pc - 1]![2]
        const lastIdx = entry.paramMap[pc - 1]![0]
        const expLen = lastIdx + 2

        // Length check
        const lenCk = lastOpt
          ? `(l===${expLen}||l===${expLen - 1})`
          : `l===${expLen}`

        // Regex constraints
        let rx = ''
        for (let i = 0; i < (entry.paramRegex?.length || 0); i++) {
          if (entry.paramRegex[i]) {
            const pmI = entry.paramMap.findIndex(([idx]) => idx === i)
            if (pmI !== -1) {
              rx += `&&${entry.paramRegex[i]!.toString()}.test(s[${entry.paramMap[pmI]![0] + 1}])`
            }
          }
        }

        // Assign params from split segments
        let asgn = ''
        for (let i = 0; i < pc; i++) {
          const [si, nm] = entry.paramMap[i]!
          asgn += `${po}${safe(pmName(entry.paramMap[i]!))}=s[${si + 1}];`
        }

        code += `if(${g}${lenCk}${rx}){${asgn}${ro}.data=$${d};return ${ro}}`
      }
    }
  }

  // Recurse into children — create a virtual node WITHOUT methods
  // to avoid re-emitting terminal handlers that were already handled above
  if (node.static || node.param || node.wildcard) {
    const childNode = { key: node.key, static: node.static, param: node.param, wildcard: node.wildcard } as RouteNode<any>
    code += emitNode(childNode, refs, pre, uid, depth + 1)
  }

  return code
}

// ── Param-aware terminal ────────────────────────────

function emitParamTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[], pre: string[], uid: { n: number },
  depth: number,
): string {
  let c = ''
  for (const m in methods) {
    const entries = methods[m]
    if (!entries) continue
    for (const entry of entries) {
      const d = addRef(refs, entry.data)
      const g = m ? `m===${JSON.stringify(m)}&&` : ''

      if (!entry.paramMap?.length) {
        c += `if(${g}l===${depth}){_rs.data=$${d};return _rs}`
        continue
      }

      const pc = entry.paramMap.length
      const lastIdx = entry.paramMap[pc - 1]![0]
      const expLen = lastIdx + 2
      const lastOpt = entry.paramMap[pc - 1]![2]
      const lenCk = lastOpt ? `(l===${expLen}||l===${expLen - 1})` : `l===${expLen}`

      const { po, ro } = allocP(pre, uid, entry.paramMap)
      let asgn = ''
      for (let i = 0; i < pc; i++) {
        const [si] = entry.paramMap[i]!
        asgn += `${po}${safe(pmName(entry.paramMap[i]!))}=s[${si + 1}];`
      }

      let rx = ''
      for (let i = 0; i < (entry.paramRegex?.length || 0); i++) {
        if (entry.paramRegex[i]) {
          const pmI = entry.paramMap.findIndex(([idx]) => idx === i)
          if (pmI !== -1) rx += `&&${entry.paramRegex[i]!.toString()}.test(s[${entry.paramMap[pmI]![0] + 1}])`
        }
      }

      c += `if(${g}${lenCk}${rx}){${asgn}${ro}.data=$${d};return ${ro}}`
    }
  }
  return c
}

// ── Terminal ────────────────────────────────────────

function emitTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  ck: string,
): string {
  let c = ''
  for (const m in methods) {
    const e = methods[m]?.[0]
    if (!e) continue
    const d = addRef(refs, e.data)
    const g = m ? `m===${JSON.stringify(m)}&&` : ''
    c += `if(${g}${ck}){_rs.data=$${d};return _rs}`
  }
  return c
}

// ── Wildcard (split-based) ──────────────────────────

function emitWildcardSplit(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[], pre: string[], uid: { n: number },
  depth: number,
): string {
  let code = ''
  for (const m in methods) {
    const entry = methods[m]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const g = m ? `if(m===${JSON.stringify(m)})` : ''
    if (entry.paramMap?.length) {
      const nm = pmName(entry.paramMap[entry.paramMap.length - 1]!)
      const { po, ro } = allocP(pre, uid, [[0, nm, false]])
      code += `${g}{${po}${safe(nm)}=s.slice(${depth}).join("/");${ro}.data=$${d};return ${ro}}`
    } else {
      code += `${g}{_rs.data=$${d};return _rs}`
    }
  }
  return code
}

// ── Wildcard (compile-time slice) ───────────────────

function emitWildcardSlice(
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
      const nm = pmName(entry.paramMap[entry.paramMap.length - 1]!)
      const { po, ro } = allocP(pre, uid, [[0, nm, false]])
      code += `${g}{${po}${safe(nm)}=p.length>=${offset}?p.slice(${offset}):"";${ro}.data=$${d};return ${ro}}`
    } else {
      code += `${g}{_rs.data=$${d};return _rs}`
    }
  }
  return code
}

// ── Helpers ─────────────────────────────────────────

function allocP(
  pre: string[],
  uid: { n: number },
  pm: Array<[number, string | RegExp, boolean]> | Array<[number, string, boolean]>,
): { po: string; ro: string } {
  const idx = uid.n++
  const po = `_p${idx}`
  const ro = `_r${idx}`
  const fields = pm.map(([, n]) => {
    const name = typeof n === 'string' ? n : String(n)
    return `${JSON.stringify(name)}:""`
  }).join(',')
  pre.push(`var ${po}={${fields}}`)
  pre.push(`var ${ro}={data:null,params:${po}}`)
  return { po, ro }
}

function emitTree(root: RouteNode<any>, refs: unknown[], pre: string[], uid: { n: number }, depth: number): string {
  return emitNode(root, refs, pre, uid, depth)
}

function pmName(pm: [number, string | RegExp, boolean]): string {
  return typeof pm[1] === 'string' ? pm[1] : String(pm[1])
}

function safe(k: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`
}

function addRef(refs: unknown[], v: unknown): number {
  let i = refs.indexOf(v)
  if (i === -1) { refs.push(v); i = refs.length - 1 }
  return i
}
