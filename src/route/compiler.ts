/**
 * Compiled Router — Zero-split JIT compiler.
 *
 * Generates a specialized function using indexOf chain instead of split().
 * Pre-allocates result + params objects for zero per-call allocation.
 *
 * Generated code pattern:
 *   const _r = {data:null,params:null}, _p0 = {id:""};
 *   return (m,p) => {
 *     if (p.length>1 && p.charCodeAt(p.length-1)===47) p=p.slice(0,-1);
 *     switch(p) { case "/users": ... }         // static O(1)
 *     var a=1, b=p.indexOf("/",1);             // first segment boundary
 *     if (b===-1) b=p.length;
 *     var n=b-1;                               // segment 1 length
 *     if (n===5 && p.startsWith("users",1)) {  // match "users"
 *       if (b===p.length) { _r.data=$0; return _r; }
 *       var a2=b+1, b2=p.indexOf("/",a2);
 *       if (b2===-1) { _p0.id=p.slice(a2); _r.data=$1; _r.params=_p0; return _r; }
 *     }
 *   };
 */

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute } from './types.ts'

export function compileRouter<T>(
  ctx: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const prealloc: string[] = []
  let pIdx = 0

  // Pre-allocated result
  prealloc.push('var _r={data:null,params:null}')

  // Static switch
  const sw = buildSwitch(ctx, refs)

  // Dynamic tree
  const dyn = buildTree(ctx.root, refs, prealloc, { n: 0 }, 1)

  if (!sw && !dyn) return () => undefined

  let body = 'if(p.length>1&&p.charCodeAt(p.length-1)===47)p=p.slice(0,-1);'
  if (sw) body += sw
  if (dyn) body += `var a=1,b=p.indexOf("/",1);if(b===-1)b=p.length;${dyn}`

  const src = `${prealloc.join(';')};return(m,p)=>{${body}}`
  const fn = new Function(...refs.map((_, i) => `$${i}`), src)
  return fn(...refs)
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
      const d = addRef(refs, e.data)
      c += method
        ? `if(m===${JSON.stringify(method)}){_r.data=$${d};_r.params=null;return _r;}`
        : `{_r.data=$${d};_r.params=null;return _r;}`
    }
    cases.push(c)
  }
  return cases.length ? `switch(p){${cases.join('')}}` : ''
}

// ── Dynamic tree → indexOf chain ────────────────────

function buildTree(
  node: RouteNode<any>,
  refs: unknown[],
  prealloc: string[],
  uid: { n: number },
  depth: number,
): string {
  let code = ''
  let hasElse = false
  // `a` = segment start offset, `b` = next "/" position (or p.length)
  // At depth 1: a=1, b=indexOf("/",1)
  // At depth N: a{N}, b{N} declared by parent

  const aVar = depth === 1 ? 'a' : `a${depth}`
  const bVar = depth === 1 ? 'b' : `b${depth}`

  // Static children
  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      const len = key.length
      const ch0 = key.charCodeAt(0)

      // Match: segment length + first char + optional startsWith
      const cond = len === 1
        ? `${bVar}-${aVar}===${len}&&p.charCodeAt(${aVar})===${ch0}`
        : `${bVar}-${aVar}===${len}&&p.charCodeAt(${aVar})===${ch0}&&p.startsWith(${JSON.stringify(key)},${aVar})`

      const inner = buildNodeInner(child, refs, prealloc, uid, depth)
      if (!inner) continue

      code += `${hasElse ? 'else ' : ''}if(${cond}){${inner}}`
      hasElse = true
    }
  }

  // Param child — matches any segment value
  if (node.param) {
    const inner = buildParamInner(node.param, refs, prealloc, uid, depth)
    if (inner) code += inner
  }

  // Wildcard — catches rest of path
  if (node.wildcard?.methods) {
    code += buildWildcard(node.wildcard.methods, refs, prealloc, uid, depth)
  }

  return code
}

function buildNodeInner(
  node: RouteNode<any>,
  refs: unknown[],
  prealloc: string[],
  uid: { n: number },
  parentDepth: number,
): string {
  let code = ''
  const bVar = parentDepth === 1 ? 'b' : `b${parentDepth}`

  // Terminal: exact match at this node
  if (node.methods) {
    code += buildTerminal(node.methods, refs, `${bVar}===p.length`)
  }

  // Deeper children — find next segment boundary
  const hasChildren = node.static || node.param || node.wildcard
  if (hasChildren) {
    const nextDepth = parentDepth + 1
    const aNext = `a${nextDepth}`
    const bNext = `b${nextDepth}`
    const deeper = buildTree(node, refs, prealloc, uid, nextDepth)
    if (deeper) {
      code += `if(${bVar}<p.length){var ${aNext}=${bVar}+1,${bNext}=p.indexOf("/",${aNext});if(${bNext}===-1)${bNext}=p.length;${deeper}}`
    }
  }

  // Wildcard fallback at this level
  if (node.wildcard?.methods && !node.static && !node.param) {
    code += buildWildcard(node.wildcard.methods, refs, prealloc, uid, parentDepth)
  }

  return code
}

function buildParamInner(
  node: RouteNode<any>,
  refs: unknown[],
  prealloc: string[],
  uid: { n: number },
  parentDepth: number,
): string {
  let code = ''
  const bVar = parentDepth === 1 ? 'b' : `b${parentDepth}`
  const aVar = parentDepth === 1 ? 'a' : `a${parentDepth}`

  // Terminal: param is the last segment
  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries?.length) continue

      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = addRef(refs, entry.data)

        // Pre-allocate param object
        const po = `_p${uid.n++}`
        const fields = entry.paramMap.map(([, name]) => {
          const n = typeof name === 'string' ? name : String(name)
          return `${JSON.stringify(n)}:""`
        })
        prealloc.push(`var ${po}={${fields.join(',')}}`)

        const guard = method ? `m===${JSON.stringify(method)}&&` : ''

        if (entry.catchAll) {
          // Wildcard param — grab rest of path
          const paramName = typeof entry.paramMap[0]![1] === 'string' ? entry.paramMap[0]![1] : '_'
          code += `if(${guard}${bVar}<=p.length){${po}[${JSON.stringify(paramName)}]=p.slice(${aVar});_r.data=$${d};_r.params=${po};return _r;}`
        } else if (entry.paramMap.length === 1) {
          // Single param — end of path check
          const paramName = typeof entry.paramMap[0]![1] === 'string' ? entry.paramMap[0]![1] : '0'
          const isOptional = entry.paramMap[0]![2]

          // Regex constraint
          let regexCheck = ''
          const regexIdx = entry.paramMap[0]![0]
          if (entry.paramRegex?.[regexIdx]) {
            regexCheck = `&&${entry.paramRegex[regexIdx]!.toString()}.test(p.slice(${aVar},${bVar}))`
          }

          if (isOptional) {
            code += `if(${guard}${bVar}===p.length){${po}[${JSON.stringify(paramName)}]=p.slice(${aVar},${bVar});_r.data=$${d};_r.params=${po};return _r;}`
          } else {
            code += `if(${guard}${bVar}===p.length${regexCheck}){${po}[${JSON.stringify(paramName)}]=p.slice(${aVar},${bVar});_r.data=$${d};_r.params=${po};return _r;}`
          }
        }
      }
    }
  }

  // Deeper children from param node
  const hasChildren = node.static || node.param || node.wildcard
  if (hasChildren) {
    const nextDepth = parentDepth + 1
    const aNext = `a${nextDepth}`
    const bNext = `b${nextDepth}`
    const deeper = buildTree(node, refs, prealloc, uid, nextDepth)
    if (deeper) {
      code += `if(${bVar}<p.length){var ${aNext}=${bVar}+1,${bNext}=p.indexOf("/",${aNext});if(${bNext}===-1)${bNext}=p.length;${deeper}}`
    }
  }

  return code
}

function buildTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  endCheck: string,
): string {
  let code = ''
  for (const method in methods) {
    const e = methods[method]?.[0]
    if (!e) continue
    const d = addRef(refs, e.data)
    const guard = method ? `m===${JSON.stringify(method)}&&` : ''
    code += `if(${guard}${endCheck}){_r.data=$${d};_r.params=null;return _r;}`
  }
  return code
}

function buildWildcard(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  prealloc: string[],
  uid: { n: number },
  parentDepth: number,
): string {
  let code = ''
  const aVar = parentDepth === 1 ? 'a' : `a${parentDepth}`

  for (const method in methods) {
    const entry = methods[method]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const guard = method ? `if(m===${JSON.stringify(method)})` : ''

    if (entry.paramMap?.length) {
      const paramName = typeof entry.paramMap[entry.paramMap.length - 1]![1] === 'string'
        ? entry.paramMap[entry.paramMap.length - 1]![1] as string
        : '_'
      const po = `_p${uid.n++}`
      prealloc.push(`var ${po}={${JSON.stringify(paramName)}:""}`)
      code += `${guard}{${po}[${JSON.stringify(paramName)}]=p.slice(${aVar});_r.data=$${d};_r.params=${po};return _r;}`
    } else {
      code += `${guard}{_r.data=$${d};_r.params=null;return _r;}`
    }
  }
  return code
}

function addRef(refs: unknown[], val: unknown): number {
  let i = refs.indexOf(val)
  if (i === -1) { refs.push(val); i = refs.length - 1 }
  return i
}
