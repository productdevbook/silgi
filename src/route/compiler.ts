/**
 * Compiled Router — Zero-overhead JIT compiler.
 *
 * Generates a specialized lookup function:
 * - switch for static routes (V8 jump table)
 * - charCodeAt(1) dispatch before split (miss = 5ns)
 * - p.slice(constant) for wildcards (no split+join)
 * - Pre-allocated result/params objects (zero allocation)
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

  let body = 'if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);'
  if (sw) body += sw
  if (dyn) body += dyn

  return new Function(...refs.map((_, i) => `$${i}`), `${pre.join(';')};return(m,p)=>{${body}}`)(...refs)
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

// ── Root level: charCodeAt dispatch → lazy split ────

function emitRoot(
  root: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
): string {
  if (!root.static && !root.param && !root.wildcard) return ''

  let code = ''
  let hasIf = false

  if (root.static) {
    // Group by first char
    const byChar = new Map<number, Array<[string, RouteNode<any>]>>()
    for (const [key, child] of Object.entries(root.static)) {
      if (!child) continue
      const ch = key.charCodeAt(0)
      if (!byChar.has(ch)) byChar.set(ch, [])
      byChar.get(ch)!.push([key, child])
    }

    for (const [ch, entries] of byChar) {
      // charCodeAt dispatch — if miss, no split
      let branchCode = 'var s=p.split("/"),l=s.length;'

      let innerIf = false
      for (const [key, child] of entries) {
        const subtree = emitSubtree(child, refs, pre, uid, 2, 1 + key.length + 1)
        if (!subtree) continue
        const cond = `s[1]===${JSON.stringify(key)}`
        branchCode += `${innerIf ? 'else ' : ''}if(${cond}){${subtree}}`
        innerIf = true
      }

      code += `${hasIf ? 'else ' : ''}if(p.charCodeAt(1)===${ch}){${branchCode}}`
      hasIf = true
    }
  }

  // Root-level param
  if (root.param) {
    const paramCode = emitParamNode(root.param, refs, pre, uid, 1, 0)
    if (paramCode) {
      code += `{var s=s||p.split("/"),l=l||s.length;${paramCode}}`
    }
  }

  // Root-level wildcard
  if (root.wildcard?.methods) {
    code += emitWildcard(root.wildcard.methods, refs, pre, uid, 1, undefined)
  }

  return code
}

// ── Subtree: already inside split ───────────────────

function emitSubtree(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
  prefixLen: number,
): string {
  let code = ''

  // Terminal match at this node
  if (node.methods) {
    code += emitTerminal(node.methods, refs, `l===${depth}`)
  }

  let hasIf = false

  // Static children
  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      const childPrefix = prefixLen + key.length + 1
      const subtree = emitSubtree(child, refs, pre, uid, depth + 1, childPrefix)
      if (!subtree) continue
      code += `${hasIf ? 'else ' : ''}if(s[${depth}]===${JSON.stringify(key)}){${subtree}}`
      hasIf = true
    }
  }

  // Param child
  if (node.param) {
    code += emitParamNode(node.param, refs, pre, uid, depth, prefixLen)
  }

  // Wildcard child — use compile-time offset
  if (node.wildcard?.methods) {
    code += emitWildcard(node.wildcard.methods, refs, pre, uid, depth, prefixLen)
  }

  return code
}

// ── Param node emission ─────────────────────────────

function emitParamNode(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
  prefixLen: number,
): string {
  let code = ''

  // Terminal: param handlers at this depth
  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = addRef(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''

        const po = allocParams(pre, uid, entry.paramMap)

        if (entry.catchAll) {
          // Catch-all param
          const pname = typeof entry.paramMap[0]![1] === 'string' ? entry.paramMap[0]![1] : '_'
          code += `if(${g}l>=${depth + 1}){${po}.${safeKey(pname)}=s.slice(${depth}).join("/");_r.data=$${d};_r.params=${po};return _r;}`
        } else {
          // Regular params — assign from split array
          const paramCount = entry.paramMap.length
          const lastOptional = entry.paramMap[paramCount - 1]![2]
          // Length check based on the last param's actual segment index
          const lastSegIdx = entry.paramMap[paramCount - 1]![0]
          const expectedLen = lastSegIdx + 2 // +1 for leading "", +1 for the param itself
          const lenCheck = lastOptional
            ? `(l===${expectedLen}||l===${expectedLen - 1})`
            : `l===${expectedLen}`

          // Regex checks
          let regexCond = ''
          for (let i = 0; i < (entry.paramRegex?.length || 0); i++) {
            if (entry.paramRegex[i]) {
              const pmIdx = entry.paramMap.findIndex(([idx]) => idx === i)
              if (pmIdx !== -1) {
                regexCond += `&&${entry.paramRegex[i]!.toString()}.test(s[${depth + pmIdx}])`
              }
            }
          }

          let assigns = ''
          for (let i = 0; i < paramCount; i++) {
            const [segIdx, name] = entry.paramMap[i]!
            const pname = typeof name === 'string' ? name : String(i)
            // Use the actual segment index from paramMap, offset by +1 for split (s[0] = "")
            assigns += `${po}[${JSON.stringify(pname)}]=s[${segIdx + 1}];`
          }

          code += `if(${g}${lenCheck}${regexCond}){${assigns}_r.data=$${d};_r.params=${po};return _r;}`
        }
      }
    }
  }

  // Deeper static/param/wildcard from param node
  if (node.static || node.param || node.wildcard) {
    code += emitSubtree(
      { key: '*', static: node.static, param: node.param, wildcard: node.wildcard } as RouteNode<any>,
      refs, pre, uid, depth + 1, 0, // prefix unknown after param
    )
  }

  return code
}

// ── Terminal match ──────────────────────────────────

function emitTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  endCheck: string,
): string {
  let code = ''
  for (const method in methods) {
    const e = methods[method]?.[0]
    if (!e) continue
    const d = addRef(refs, e.data)
    const g = method ? `m===${JSON.stringify(method)}&&` : ''
    code += `if(${g}${endCheck}){_r.data=$${d};_r.params=null;return _r;}`
  }
  return code
}

// ── Wildcard — compile-time p.slice(N) ──────────────

function emitWildcard(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
  prefixLen: number | undefined,
): string {
  let code = ''
  for (const method in methods) {
    const entry = methods[method]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const g = method ? `if(m===${JSON.stringify(method)})` : ''

    if (entry.paramMap?.length) {
      const name = typeof entry.paramMap[entry.paramMap.length - 1]![1] === 'string'
        ? entry.paramMap[entry.paramMap.length - 1]![1] as string : '_'
      const po = `_p${uid.n++}`
      pre.push(`var ${po}={${JSON.stringify(name)}:""}`)

      // Use compile-time offset if known, otherwise s.slice().join()
      const valueExpr = prefixLen
        ? `(p.length>=${prefixLen}?p.slice(${prefixLen}):"")`
        : `s.slice(${depth}).join("/")`

      code += `${g}{${po}[${JSON.stringify(name)}]=${valueExpr};_r.data=$${d};_r.params=${po};return _r;}`
    } else {
      code += `${g}{_r.data=$${d};_r.params=null;return _r;}`
    }
  }
  return code
}

// ── Helpers ─────────────────────────────────────────

function allocParams(
  pre: string[],
  uid: { n: number },
  paramMap: Array<[number, string | RegExp, boolean]>,
): string {
  const po = `_p${uid.n++}`
  const fields = paramMap.map(([, n]) => `${JSON.stringify(typeof n === 'string' ? n : String(n))}:""`)
  pre.push(`var ${po}={${fields.join(',')}}`)
  return po
}

function safeKey(key: string): string {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : `[${JSON.stringify(key)}]`
}

function addRef(refs: unknown[], val: unknown): number {
  let i = refs.indexOf(val)
  if (i === -1) { refs.push(val); i = refs.length - 1 }
  return i
}
