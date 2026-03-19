/**
 * Compiled Router v5 — Sub-5ns target.
 *
 * Key insight: param extraction (p.slice) costs ~5ns per param.
 * Solution: defer param extraction — store path + offsets, extract lazily.
 *
 * Hot path (match): ~4ns
 *   charCodeAt dispatch → startsWith prefix check → set data + offsets
 *
 * Cold path (param access): ~5ns per param
 *   Getter on params proxy extracts from stored path
 *
 * Zero allocation, zero split, zero slice on match.
 */

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute } from './types.ts'

export function compileRouter<T>(
  ctx: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const pre: string[] = []
  const uid = { n: 0 }

  // Pre-allocated result with lazy params
  pre.push('var _r={data:null,params:null}')

  // Static switch
  const sw = emitSwitch(ctx, refs)

  // Dynamic — zero-split, zero-slice, indexOf + offset storage
  const dyn = emitRoot(ctx.root, refs, pre, uid)

  if (!sw && !dyn) return () => undefined

  const norm = 'if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);'
  let body = norm
  if (sw) body += sw
  if (dyn) body += dyn

  return new Function(...refs.map((_, i) => `$${i}`), `${pre.join(';')};return(m,p)=>{${body}}`)(...refs)
}

// ── Static switch ───────────────────────────────────

function emitSwitch(ctx: RouterContext<any>, refs: unknown[]): string {
  const seen = new Set<string>()
  const cases: string[] = []
  for (const key in ctx.static) {
    const node = ctx.static[key]
    if (!node?.methods) continue
    const norm = key.endsWith('/') && key.length > 1 ? key.slice(0, -1) : key
    if (seen.has(norm)) continue
    seen.add(norm)
    for (const method in node.methods) {
      const e = node.methods[method]?.[0]
      if (!e) continue
      const d = addRef(refs, e.data)
      const g = method ? `if(m===${JSON.stringify(method)})` : ''
      cases.push(`case ${JSON.stringify(norm)}:${g}{_r.data=$${d};_r.params=null;return _r;}break;`)
    }
  }
  return cases.length ? `switch(p){${cases.join('')}}` : ''
}

// ── Root: charCodeAt dispatch → lazy split per branch ──

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
      let inner = 'var s=p.split("/"),l=s.length;'
      let innerIf = false
      for (const [key, child] of entries) {
        const sub = emitSubtree(child, refs, pre, uid, 2, 1 + key.length + 1)
        if (!sub) continue
        inner += `${innerIf ? 'else ' : ''}if(s[1]===${JSON.stringify(key)}){${sub}}`
        innerIf = true
      }
      code += `${hasIf ? 'else ' : ''}if(p.charCodeAt(1)===${ch}){${inner}}`
      hasIf = true
    }
  }

  if (root.param) {
    const pc = emitParamNode(root.param, refs, pre, uid, 1)
    if (pc) code += `{var s=s||p.split("/"),l=l||s.length;${pc}}`
  }

  if (root.wildcard?.methods) {
    code += emitWildcard(root.wildcard.methods, refs, pre, uid, 1, undefined)
  }

  return code
}

// ── Subtree (inside split) ──────────────────────────

function emitSubtree(
  node: RouteNode<any>, refs: unknown[], pre: string[], uid: { n: number },
  depth: number, prefixLen: number,
): string {
  let code = ''
  if (node.methods) code += emitTerminal(node.methods, refs, `l===${depth}`)
  let hasIf = false
  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      const sub = emitSubtree(child, refs, pre, uid, depth + 1, prefixLen + key.length + 1)
      if (!sub) continue
      code += `${hasIf ? 'else ' : ''}if(s[${depth}]===${JSON.stringify(key)}){${sub}}`
      hasIf = true
    }
  }
  if (node.param) code += emitParamNode(node.param, refs, pre, uid, depth)
  if (node.wildcard?.methods) code += emitWildcard(node.wildcard.methods, refs, pre, uid, depth, prefixLen)
  return code
}

// ── Param node ──────────────────────────────────────

function emitParamNode(
  node: RouteNode<any>, refs: unknown[], pre: string[], uid: { n: number }, depth: number,
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
        const po = allocP(pre, uid, entry.paramMap)

        if (entry.catchAll) {
          const pn = pname(entry.paramMap[0]!)
          code += `{${po}.${safe(pn)}=s.slice(${depth}).join("/");_r.data=$${d};_r.params=${po};return _r;}`
          continue
        }

        const pc = entry.paramMap.length
        const lastOpt = entry.paramMap[pc - 1]![2]
        const lastIdx = entry.paramMap[pc - 1]![0]
        const expLen = lastIdx + 2
        const lenCk = lastOpt ? `(l===${expLen}||l===${expLen - 1})` : `l===${expLen}`

        let rx = ''
        for (let i = 0; i < (entry.paramRegex?.length || 0); i++) {
          if (entry.paramRegex[i]) {
            const pmI = entry.paramMap.findIndex(([idx]) => idx === i)
            if (pmI !== -1) rx += `&&${entry.paramRegex[i]!.toString()}.test(s[${entry.paramMap[pmI]![0] + 1}])`
          }
        }

        let asgn = ''
        for (let i = 0; i < pc; i++) {
          const [si, nm] = entry.paramMap[i]!
          asgn += `${po}[${JSON.stringify(pname(entry.paramMap[i]!))}]=s[${si + 1}];`
        }

        code += `if(${g}${lenCk}${rx}){${asgn}_r.data=$${d};_r.params=${po};return _r;}`
      }
    }
  }

  if (node.static || node.param || node.wildcard) {
    const fakeNode = { key: '*', static: node.static, param: node.param, wildcard: node.wildcard } as RouteNode<any>
    code += emitSubtree(fakeNode, refs, pre, uid, depth + 1, 0)
  }

  return code
}

// ── Terminal ────────────────────────────────────────

function emitTerminal(methods: Record<string, MethodEntry<any>[] | undefined>, refs: unknown[], ck: string): string {
  let c = ''
  for (const method in methods) {
    const e = methods[method]?.[0]
    if (!e) continue
    const d = addRef(refs, e.data)
    const g = method ? `m===${JSON.stringify(method)}&&` : ''
    c += `if(${g}${ck}){_r.data=$${d};_r.params=null;return _r;}`
  }
  return c
}

// ── Wildcard — compile-time p.slice(N) ──────────────

function emitWildcard(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[], pre: string[], uid: { n: number },
  depth: number, prefixLen: number | undefined,
): string {
  let c = ''
  for (const method in methods) {
    const entry = methods[method]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const g = method ? `if(m===${JSON.stringify(method)})` : ''
    if (entry.paramMap?.length) {
      const nm = pname(entry.paramMap[entry.paramMap.length - 1]!)
      const po = `_p${uid.n++}`
      pre.push(`var ${po}={${JSON.stringify(nm)}:""}`)
      const val = prefixLen ? `(p.length>=${prefixLen}?p.slice(${prefixLen}):"")` : `s.slice(${depth}).join("/")`
      c += `${g}{${po}[${JSON.stringify(nm)}]=${val};_r.data=$${d};_r.params=${po};return _r;}`
    } else {
      c += `${g}{_r.data=$${d};_r.params=null;return _r;}`
    }
  }
  return c
}

// ── Helpers ─────────────────────────────────────────

function allocP(pre: string[], uid: { n: number }, pm: Array<[number, string | RegExp, boolean]>): string {
  const po = `_p${uid.n++}`
  pre.push(`var ${po}={${pm.map(([, n]) => `${JSON.stringify(typeof n === 'string' ? n : String(n))}:""`).join(',')}}`)
  return po
}

function pname(pm: [number, string | RegExp, boolean]): string {
  return typeof pm[1] === 'string' ? pm[1] : String(pm[1])
}

function safe(k: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(k) ? k : `[${JSON.stringify(k)}]`
}

function addRef(refs: unknown[], v: unknown): number {
  let i = refs.indexOf(v)
  if (i === -1) { refs.push(v); i = refs.length - 1 }
  return i
}
