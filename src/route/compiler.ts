/**
 * Compiled Router v4 — Hybrid: split + pre-allocated objects.
 *
 * Combines best of both worlds:
 * 1. switch() for static routes — O(1), no split needed
 * 2. split() for dynamic routes — same as rou3 (V8 optimizes well)
 * 3. Pre-allocated result + params objects — ZERO allocation per match
 *    (rou3 creates new objects on every match)
 * 4. charCodeAt first-char dispatch — fast reject
 *
 * The key advantage over rou3: rou3 does `return { data, params: { id: s[2] } }`
 * on every match (2 allocations). We do `_p.id = s[2]; _r.data = $0; return _r`
 * (0 allocations, just property writes).
 */

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute } from './types.ts'

export function compileRouter<T>(
  ctx: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const prealloc: string[] = []
  const uid = { n: 0 }

  prealloc.push('var _r={data:null,params:null}')

  // Static switch
  const sw = buildSwitch(ctx, refs)

  // Dynamic tree with split
  const dyn = emitNode(ctx.root, refs, prealloc, uid, 1)

  if (!sw && !dyn) return () => undefined

  const normalize = 'if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);'
  let body = normalize
  if (sw) body += sw
  // Split lazily — only when dynamic route has a chance to match
  // First char of segment 1 is checked BEFORE split
  if (dyn) body += dyn

  const src = `${prealloc.join(';')};return(m,p)=>{${body}}`
  return new Function(...refs.map((_, i) => `$${i}`), src)(...refs)
}

// ── Static switch ───────────────────────────────────

function buildSwitch(ctx: RouterContext<any>, refs: unknown[]): string {
  const seen = new Set<string>()
  const cases: string[] = []
  for (const key in ctx.static) {
    const node = ctx.static[key]
    if (!node?.methods) continue
    const norm = key.endsWith('/') && key.length > 1 ? key.slice(0, -1) : key
    if (seen.has(norm)) continue
    seen.add(norm)
    let c = `case ${JSON.stringify(norm)}:`
    for (const method in node.methods) {
      const e = node.methods[method]?.[0]
      if (!e) continue
      const d = ref(refs, e.data)
      c += method
        ? `if(m===${JSON.stringify(method)}){_r.data=$${d};_r.params=null;return _r;}`
        : `_r.data=$${d};_r.params=null;return _r;`
    }
    cases.push(c)
  }
  return cases.length ? `switch(p){${cases.join('')}}` : ''
}

// ── Dynamic tree → split-based if/else ──────────────

function emitNode(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
  splitDone?: boolean,
): string {
  let code = ''
  let hasIf = false

  // At depth 1 (root children): lazy split per branch
  const needsSplit = depth === 1 && !splitDone

  // Terminal match
  if (node.methods && depth > 1) {
    const term = emitTerminal(node.methods, refs, depth, node.key === '*')
    if (term) {
      const optCheck = node.key === '*' ? `||l===${depth - 1}` : ''
      code += `if(l===${depth}${optCheck}){${term}}`
      hasIf = true
    }
  }

  // Static children
  if (node.static) {
    if (needsSplit) {
      // Depth 1: group by first char → split inside each group
      // Miss = 1 charCodeAt check (~1ns). Match = split + compare (~25ns)
      const byChar = new Map<number, Array<[string, RouteNode<any>]>>()
      for (const [key, child] of Object.entries(node.static)) {
        if (!child) continue
        const ch = key.charCodeAt(0)
        if (!byChar.has(ch)) byChar.set(ch, [])
        byChar.get(ch)!.push([key, child])
      }

      for (const [ch, entries] of byChar) {
        let inner = ''
        for (const [key, child] of entries) {
          const childCode = emitNode(child, refs, pre, uid, depth + 1, true)
          if (!childCode) continue
          const cond = key.length > 1
            ? `s[1].charCodeAt(0)===${ch}&&s[1]===${JSON.stringify(key)}`
            : `s[1]===${JSON.stringify(key)}`
          inner += `${inner ? 'else ' : ''}if(${cond}){${childCode}}`
        }
        if (inner) {
          code += `${hasIf ? 'else ' : ''}if(p.charCodeAt(1)===${ch}){var s=p.split("/"),l=s.length;${inner}}`
          hasIf = true
        }
      }
    } else {
      for (const [key, child] of Object.entries(node.static)) {
        if (!child) continue
        const inner = emitNode(child, refs, pre, uid, depth + 1, true)
        if (!inner) continue
        const ch = key.charCodeAt(0)
        const cond = key.length > 1
          ? `s[${depth}].charCodeAt(0)===${ch}&&s[${depth}]===${JSON.stringify(key)}`
          : `s[${depth}]===${JSON.stringify(key)}`
        code += `${hasIf ? 'else ' : ''}if(${cond}){${inner}}`
        hasIf = true
      }
    }
  }

  // Param child
  if (node.param) {
    const paramInner = emitParam(node.param, refs, pre, uid, depth)
    if (paramInner) {
      if (needsSplit) {
        code += `{var s=s||p.split("/"),l=l||s.length;${paramInner}}`
      } else {
        code += paramInner
      }
    }
  }

  // Wildcard child
  if (node.wildcard?.methods) {
    const wcInner = emitWildcard(node.wildcard.methods, refs, pre, uid, depth)
    if (wcInner) {
      if (needsSplit) {
        code += `{var s=s||p.split("/"),l=l||s.length;${wcInner}}`
      } else {
        code += wcInner
      }
    }
  }

  return code
}

function emitTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  depth: number,
  isOptional: boolean,
): string {
  let code = ''
  for (const method in methods) {
    const e = methods[method]?.[0]
    if (!e) continue
    const d = ref(refs, e.data)
    const g = method ? `m===${JSON.stringify(method)}&&` : ''
    code += `if(${g}1){_r.data=$${d};_r.params=null;return _r;}`
  }
  return code
}

function emitParam(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
): string {
  let code = ''

  // Terminal: param is the value at s[depth]
  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = ref(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''

        // Pre-allocate param object
        const po = `_p${uid.n++}`
        const fields = entry.paramMap.map(([, n]) => `${JSON.stringify(typeof n === 'string' ? n : String(n))}:""`)
        pre.push(`var ${po}={${fields.join(',')}}`)

        if (entry.catchAll) {
          // Wildcard param — join remaining
          const pname = typeof entry.paramMap[0]![1] === 'string' ? entry.paramMap[0]![1] : '_'
          code += `{${po}[${JSON.stringify(pname)}]=s.slice(${depth}).join("/");_r.data=$${d};_r.params=${po};return _r;}`
          continue
        }

        // Conditions
        const conds: string[] = []
        if (g) conds.push(g.slice(0, -2))

        // Length check
        const lastPM = entry.paramMap[entry.paramMap.length - 1]!
        if (!lastPM[2] /* not optional */) {
          conds.push(`l===${depth + entry.paramMap.length}`)
        } else {
          conds.push(`(l===${depth + entry.paramMap.length}||l===${depth + entry.paramMap.length - 1})`)
        }

        // Regex constraints
        for (let i = 0; i < (entry.paramRegex?.length || 0); i++) {
          if (entry.paramRegex[i]) {
            const pmEntry = entry.paramMap[i]
            if (pmEntry) {
              conds.push(`${entry.paramRegex[i]!.toString()}.test(s[${depth + i}])`)
            }
          }
        }

        // Assign params
        let assigns = ''
        for (let i = 0; i < entry.paramMap.length; i++) {
          const [, name] = entry.paramMap[i]!
          const pname = typeof name === 'string' ? name : String(i)
          assigns += `${po}[${JSON.stringify(pname)}]=s[${depth + i}];`
        }

        code += `if(${conds.join('&&')}){${assigns}_r.data=$${d};_r.params=${po};return _r;}`
      }
    }
  }

  // Deeper children from param node
  if (node.static || node.param || node.wildcard) {
    code += emitNode(node, refs, pre, uid, depth + 1)
  }

  return code
}

function emitWildcard(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
): string {
  let code = ''
  for (const method in methods) {
    const entry = methods[method]?.[0]
    if (!entry) continue
    const d = ref(refs, entry.data)
    const g = method ? `if(m===${JSON.stringify(method)})` : ''

    if (entry.paramMap?.length) {
      const name = typeof entry.paramMap[entry.paramMap.length - 1]![1] === 'string'
        ? entry.paramMap[entry.paramMap.length - 1]![1] as string : '_'
      const po = `_p${uid.n++}`
      pre.push(`var ${po}={${JSON.stringify(name)}:""}`)
      code += `${g}{${po}[${JSON.stringify(name)}]=s.slice(${depth}).join("/");_r.data=$${d};_r.params=${po};return _r;}`
    } else {
      code += `${g}{_r.data=$${d};_r.params=null;return _r;}`
    }
  }
  return code
}

function ref(refs: unknown[], val: unknown): number {
  let i = refs.indexOf(val)
  if (i === -1) { refs.push(val); i = refs.length - 1 }
  return i
}
