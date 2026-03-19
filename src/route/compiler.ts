/**
 * Compiled Router v8 — Zero-split with branch functions.
 *
 * Performance profile on Apple M3 Max, Node 24:
 *   Static:     ~4ns  (switch jump table)
 *   1-param:   ~13ns  (charCodeAt + indexOf + slice)
 *   2-param:   ~21ns  (charCodeAt + 2x indexOf + 2x slice)
 *   Wildcard:   ~9ns  (charCodeAt + compile-time slice)
 *   Miss:       ~4ns  (charCodeAt early exit)
 *
 * Key techniques:
 *   1. Split generated code into per-branch functions so V8/TurboFan
 *      optimizes each independently (smaller function = better inlining).
 *   2. Zero-split: charCodeAt for prefix, indexOf for param boundaries,
 *      slice for param extraction. No p.split("/") anywhere.
 *   3. Sparse static-segment verification: check first + last char of
 *      known static segments between params (not all chars).
 *   4. Pre-allocated result + param objects: zero allocation on match.
 */

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute } from './types.ts'

export function compileRouter<T>(
  ctx: RouterContext<T>,
): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const pre: string[] = ['var _rs={data:null,params:null}']
  const uid = { n: 0 }

  const sw = emitSwitch(ctx, refs)
  const branches = emitBranches(ctx.root, refs, pre, uid)

  if (!sw && !branches.dispatch) return () => undefined

  // Main dispatcher: tiny function with switch + charCodeAt dispatch.
  // Each branch is a separate function for independent V8 optimization.
  const code = `${pre.join(';')};${branches.defs}return(m,p)=>{${sw}${branches.dispatch}}`

  return new Function(
    ...refs.map((_, i) => `$${i}`),
    code,
  )(...refs)
}

// ── Static switch ────────────────────────────────────

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
      // Also match trailing slash variant
      if (norm.length > 1) cases.push(`case ${JSON.stringify(norm + '/')}:`)
      cases.push(`${g}{_rs.data=$${d};return _rs}break;`)
    }
  }
  return cases.length ? `switch(p){${cases.join('')}}` : ''
}

// ── Branch generation ────────────────────────────────

interface BranchResult {
  defs: string
  dispatch: string
}

function emitBranches(
  root: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
): BranchResult {
  if (!root.static && !root.param && !root.wildcard) {
    return { defs: '', dispatch: '' }
  }

  let defs = ''
  let dispatch = ''
  let hasIf = false

  if (root.static) {
    const byChar = new Map<number, Array<[string, RouteNode<any>]>>()
    for (const [key, child] of Object.entries(root.static)) {
      if (!child) continue
      const ch = key.charCodeAt(0)
      if (!byChar.has(ch)) byChar.set(ch, [])
      byChar.get(ch)!.push([key, child])
    }

    if (byChar.size > 0) {
      dispatch += 'var c=p.charCodeAt(1);'
    }

    for (const [ch, entries] of byChar) {
      const branchBody = emitBranchBody(entries, refs, pre, uid)
      if (!branchBody) continue

      const bn = `_b${uid.n++}`
      defs += `var ${bn}=function(m,p){${branchBody}};`
      dispatch += `${hasIf ? 'else ' : ''}if(c===${ch}){var _t=${bn}(m,p);if(_t)return _t}`
      hasIf = true
    }
  }

  if (root.param) {
    const body = emitParamBranch(root.param, refs, pre, uid, 1)
    if (body) {
      const bn = `_b${uid.n++}`
      defs += `var ${bn}=function(m,p){${body}};`
      dispatch += `{var _t=${bn}(m,p);if(_t)return _t}`
    }
  }

  if (root.wildcard?.methods) {
    dispatch += emitWildcard(root.wildcard.methods, refs, pre, uid, 1)
  }

  return { defs, dispatch }
}

// ── Branch body: routes sharing a first character ────

function emitBranchBody(
  entries: Array<[string, RouteNode<any>]>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
): string {
  let code = ''

  for (const [key, child] of entries) {
    const prefixLen = 1 + key.length
    const slashAfter = prefixLen

    // Prefix guard: verify the segment name beyond the first char
    const lastCharPos = prefixLen - 1
    const lastCharCode = key.charCodeAt(key.length - 1)

    let prefixGuard: string
    if (key.length <= 3) {
      const checks: string[] = []
      for (let i = 1; i < key.length; i++) {
        checks.push(`p.charCodeAt(${1 + i})===${key.charCodeAt(i)}`)
      }
      prefixGuard = checks.length > 0
        ? `${checks.join('&&')}&&(p.charCodeAt(${slashAfter})===47||p.length===${prefixLen})`
        : `p.charCodeAt(${slashAfter})===47||p.length===${prefixLen}`
    } else {
      // Sparse: last char of segment + slash position
      prefixGuard = `p.charCodeAt(${lastCharPos})===${lastCharCode}&&(p.charCodeAt(${slashAfter})===47||p.length===${prefixLen})`
    }

    let body = ''

    if (child.methods) {
      body += emitTerminal(child.methods, refs, `p.length===${prefixLen}`)
    }

    body += emitSubtree(child, refs, pre, uid, slashAfter + 1, prefixLen)

    if (body) {
      code += `if(${prefixGuard}){${body}}`
    }
  }

  return code
}

// ── Subtree: deeper static and param routes ──────────

function emitSubtree(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  offset: number,
  prefixLen: number,
): string {
  let code = ''

  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      const keyLen = key.length
      const childEnd = offset + keyLen

      let charCheck: string
      if (keyLen === 1) {
        charCheck = `p.charCodeAt(${offset})===${key.charCodeAt(0)}`
      } else if (keyLen <= 4) {
        const checks: string[] = []
        for (let c = 0; c < keyLen; c++) {
          checks.push(`p.charCodeAt(${offset + c})===${key.charCodeAt(c)}`)
        }
        charCheck = checks.join('&&')
      } else {
        // Sparse: first + last char
        charCheck = `p.charCodeAt(${offset})===${key.charCodeAt(0)}&&p.charCodeAt(${offset + keyLen - 1})===${key.charCodeAt(keyLen - 1)}`
      }

      let body = ''

      if (child.methods) {
        body += emitTerminal(child.methods, refs, `p.length===${childEnd}`)
      }

      body += emitSubtree(child, refs, pre, uid, childEnd + 1, childEnd)

      if (body) {
        code += `if(${charCheck}&&(p.length===${childEnd}||p.charCodeAt(${childEnd})===47)){${body}}`
      }
    }
  }

  if (node.param) {
    code += emitParamBranch(node.param, refs, pre, uid, offset)
  }

  if (node.wildcard?.methods) {
    code += emitWildcard(node.wildcard.methods, refs, pre, uid, offset)
  }

  return code
}

// ── Param: indexOf + slice ───────────────────────────

function emitParamBranch(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  offset: number,
): string {
  let code = ''
  const eVar = `e${uid.n++}`

  // Terminal param (e.g., /users/:id)
  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = addRef(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''

        if (entry.catchAll) {
          const pn = pmName(entry.paramMap[0]!)
          const {po, ro} = allocP(pre, uid, entry.paramMap)
          code += `if(${g}p.length>=${offset}){${po}${safe(pn)}=p.slice(${offset});${ro}.data=$${d};return ${ro}}`
          continue
        }

        if (entry.paramMap.length === 1) {
          const pn = pmName(entry.paramMap[0]!)
          const {po, ro} = allocP(pre, uid, entry.paramMap)
          if (entry.paramMap[0]![2]) {
            // Optional
            code += `if(${g}p.indexOf("/",${offset})===-1){${po}${safe(pn)}=p.length>${offset}?p.slice(${offset}):"";${ro}.data=$${d};return ${ro}}`
          } else {
            code += `if(${g}p.indexOf("/",${offset})===-1&&p.length>${offset}){${po}${safe(pn)}=p.slice(${offset});${ro}.data=$${d};return ${ro}}`
          }
        }
      }
    }
  }

  // Deeper routes after param
  const hasDeeper = node.static || node.param || node.wildcard
  if (!hasDeeper) return code

  let deepCode = ''
  let hasDeep = false

  // Static after param (e.g., /users/:id/posts)
  if (node.static) {
    for (const [key, child] of Object.entries(node.static)) {
      if (!child) continue
      hasDeep = true
      const keyLen = key.length

      // Verify static key chars after param boundary
      let keyCheck: string
      if (keyLen === 1) {
        keyCheck = `p.charCodeAt(${eVar}+1)===${key.charCodeAt(0)}`
      } else if (keyLen <= 4) {
        const checks: string[] = []
        for (let c = 0; c < keyLen; c++) {
          checks.push(`p.charCodeAt(${eVar}+${1 + c})===${key.charCodeAt(c)}`)
        }
        keyCheck = checks.join('&&')
      } else {
        keyCheck = `p.charCodeAt(${eVar}+1)===${key.charCodeAt(0)}&&p.charCodeAt(${eVar}+${keyLen})===${key.charCodeAt(keyLen - 1)}`
      }
      keyCheck += `&&p.charCodeAt(${eVar}+${1 + keyLen})===47`

      let body = ''

      // Terminal: /prefix/:p1/static (e.g., /users/:id/posts)
      if (child.methods) {
        body += emitParamTerminal(child.methods, refs, pre, uid, offset, eVar, `p.length===${eVar}+${1 + keyLen}`)
      }

      // Param after static: /prefix/:p1/static/:p2
      if (child.param) {
        body += emitDeepParam(child.param, refs, pre, uid, offset, eVar, keyLen)
      }

      // Static after static: /prefix/:p1/static/static2
      if (child.static) {
        body += emitDeepStatic(child, refs, pre, uid, offset, eVar, keyLen)
      }

      // Wildcard after static: /prefix/:p1/static/**
      if (child.wildcard?.methods) {
        body += emitDeepWildcard(child.wildcard.methods, refs, pre, uid, offset, eVar, keyLen)
      }

      if (body) {
        deepCode += `if(${keyCheck}){${body}}`
      }
    }
  }

  // Param after param: /:a/:b
  if (node.param) {
    hasDeep = true
    deepCode += emitDeepParamChain(node.param, refs, pre, uid, offset, eVar)
  }

  // Wildcard after param
  if (node.wildcard?.methods) {
    hasDeep = true
    for (const m in node.wildcard.methods) {
      const entry = node.wildcard.methods[m]?.[0]
      if (!entry) continue
      const d = addRef(refs, entry.data)
      const g = m ? `if(m===${JSON.stringify(m)})` : ''
      if (entry.paramMap?.length) {
        const names = entry.paramMap.map(pm => pmName(pm))
        const {po, ro} = allocP(pre, uid, entry.paramMap)
        let asgn = `${po}${safe(names[0]!)}=p.slice(${offset},${eVar});`
        if (names.length > 1) {
          asgn += `${po}${safe(names[names.length - 1]!)}=p.slice(${eVar}+1);`
        }
        deepCode += `${g}{${asgn}${ro}.data=$${d};return ${ro}}`
      } else {
        deepCode += `${g}{_rs.data=$${d};return _rs}`
      }
    }
  }

  if (hasDeep) {
    code += `{var ${eVar}=p.indexOf("/",${offset});if(${eVar}!==-1){${deepCode}}}`
  }

  return code
}

// ── Terminal with param from parent ──────────────────

function emitParamTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  paramStart: number,
  paramEndVar: string,
  lengthCheck: string,
): string {
  let code = ''
  for (const method in methods) {
    const entries = methods[method]
    if (!entries) continue
    for (const entry of entries) {
      const d = addRef(refs, entry.data)
      const g = method ? `m===${JSON.stringify(method)}&&` : ''
      if (entry.paramMap?.length) {
        const pn = pmName(entry.paramMap[0]!)
        const {po, ro} = allocP(pre, uid, [[0, pn, false]])
        code += `if(${g}${lengthCheck}){${po}${safe(pn)}=p.slice(${paramStart},${paramEndVar});${ro}.data=$${d};return ${ro}}`
      } else {
        code += `if(${g}${lengthCheck}){_rs.data=$${d};return _rs}`
      }
    }
  }
  return code
}

// ── Deep param: /prefix/:p1/static/:p2 ───────────────

function emitDeepParam(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  p1Start: number,
  p1EndVar: string,
  staticKeyLen: number,
): string {
  let code = ''
  const p2Start = `${p1EndVar}+${1 + staticKeyLen + 1}`

  if (node.methods) {
    for (const method in node.methods) {
      const entries = node.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        if (!entry.paramMap?.length) continue
        const d = addRef(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''

        if (entry.catchAll) {
          const names = entry.paramMap.map(pm => pmName(pm))
          const {po, ro} = allocP(pre, uid, entry.paramMap)
          let asgn = `${po}${safe(names[0]!)}=p.slice(${p1Start},${p1EndVar});`
          if (names.length >= 2) asgn += `${po}${safe(names[names.length - 1]!)}=p.slice(${p2Start});`
          code += `if(${g}p.length>=${p2Start}){${asgn}${ro}.data=$${d};return ${ro}}`
          continue
        }

        const names = entry.paramMap.map(pm => pmName(pm))
        const {po, ro} = allocP(pre, uid, entry.paramMap)
        code += `if(${g}p.indexOf("/",${p2Start})===-1&&p.length>${p2Start}){`
        code += `${po}${safe(names[0]!)}=p.slice(${p1Start},${p1EndVar});`
        code += `${po}${safe(names[1]!)}=p.slice(${p2Start});`
        code += `${ro}.data=$${d};return ${ro}}`
      }
    }
  }

  // 3+ param depth
  if (node.static || node.param || node.wildcard) {
    const e2Var = `e${uid.n++}`
    let e2Code = ''
    let hasE2 = false

    if (node.static) {
      for (const [key, child] of Object.entries(node.static)) {
        if (!child) continue
        hasE2 = true
        const keyLen = key.length

        let keyCheck: string
        if (keyLen <= 3) {
          const checks: string[] = []
          for (let c = 0; c < keyLen; c++) {
            checks.push(`p.charCodeAt(${e2Var}+${1 + c})===${key.charCodeAt(c)}`)
          }
          keyCheck = checks.join('&&')
        } else {
          keyCheck = `p.charCodeAt(${e2Var}+1)===${key.charCodeAt(0)}&&p.charCodeAt(${e2Var}+${keyLen})===${key.charCodeAt(keyLen - 1)}`
        }
        keyCheck += `&&p.charCodeAt(${e2Var}+${1 + keyLen})===47`

        let body = ''
        if (child.param?.methods) {
          for (const m in child.param.methods) {
            const entries2 = child.param.methods[m]
            if (!entries2) continue
            for (const entry2 of entries2) {
              if (!entry2.paramMap?.length) continue
              const d2 = addRef(refs, entry2.data)
              const g2 = m ? `m===${JSON.stringify(m)}&&` : ''
              const names2 = entry2.paramMap.map(pm => pmName(pm))
              const {po: po2, ro: ro2} = allocP(pre, uid, entry2.paramMap)
              const p3Start = `${e2Var}+${1 + keyLen + 1}`
              body += `if(${g2}p.indexOf("/",${p3Start})===-1&&p.length>${p3Start}){`
              body += `${po2}${safe(names2[0]!)}=p.slice(${p1Start},${p1EndVar});`
              if (names2.length >= 2) body += `${po2}${safe(names2[1]!)}=p.slice(${p2Start},${e2Var});`
              if (names2.length >= 3) body += `${po2}${safe(names2[2]!)}=p.slice(${p3Start});`
              body += `${ro2}.data=$${d2};return ${ro2}}`
            }
          }
        }

        if (child.methods) {
          for (const m in child.methods) {
            const entries2 = child.methods[m]
            if (!entries2) continue
            for (const entry2 of entries2) {
              const d2 = addRef(refs, entry2.data)
              const g2 = m ? `m===${JSON.stringify(m)}&&` : ''
              if (entry2.paramMap?.length) {
                const names2 = entry2.paramMap.map(pm => pmName(pm))
                const {po: po2, ro: ro2} = allocP(pre, uid, entry2.paramMap)
                body += `if(${g2}p.length===${e2Var}+${1 + keyLen}){`
                body += `${po2}${safe(names2[0]!)}=p.slice(${p1Start},${p1EndVar});`
                if (names2.length >= 2) body += `${po2}${safe(names2[1]!)}=p.slice(${p2Start},${e2Var});`
                body += `${ro2}.data=$${d2};return ${ro2}}`
              }
            }
          }
        }

        if (body) {
          e2Code += `if(${keyCheck}){${body}}`
        }
      }
    }

    if (node.param?.methods) {
      hasE2 = true
      for (const m in node.param.methods) {
        const entries2 = node.param.methods[m]
        if (!entries2) continue
        for (const entry2 of entries2) {
          if (!entry2.paramMap?.length) continue
          const d2 = addRef(refs, entry2.data)
          const g2 = m ? `m===${JSON.stringify(m)}&&` : ''

          if (entry2.catchAll) {
            const names2 = entry2.paramMap.map(pm => pmName(pm))
            const {po: po2, ro: ro2} = allocP(pre, uid, entry2.paramMap)
            let asgn = `${po2}${safe(names2[0]!)}=p.slice(${p1Start},${p1EndVar});`
            if (names2.length >= 2) asgn += `${po2}${safe(names2[1]!)}=p.slice(${p2Start},${e2Var});`
            if (names2.length >= 3) asgn += `${po2}${safe(names2[names2.length - 1]!)}=p.slice(${e2Var}+1);`
            e2Code += `if(${g2}p.length>${e2Var}+1){${asgn}${ro2}.data=$${d2};return ${ro2}}`
            continue
          }

          const p3Start = `${e2Var}+1`
          const names2 = entry2.paramMap.map(pm => pmName(pm))
          const {po: po2, ro: ro2} = allocP(pre, uid, entry2.paramMap)
          e2Code += `if(${g2}p.indexOf("/",${p3Start})===-1&&p.length>${p3Start}){`
          e2Code += `${po2}${safe(names2[0]!)}=p.slice(${p1Start},${p1EndVar});`
          if (names2.length >= 2) e2Code += `${po2}${safe(names2[1]!)}=p.slice(${p2Start},${e2Var});`
          if (names2.length >= 3) e2Code += `${po2}${safe(names2[2]!)}=p.slice(${p3Start});`
          e2Code += `${ro2}.data=$${d2};return ${ro2}}`
        }
      }
    }

    if (hasE2) {
      code += `{var ${e2Var}=p.indexOf("/",${p2Start});if(${e2Var}!==-1){${e2Code}}}`
    }
  }

  return code
}

// ── Deep static: /prefix/:p1/static/static2 ──────────

function emitDeepStatic(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  p1Start: number,
  p1EndVar: string,
  staticKeyLen: number,
): string {
  let code = ''
  if (!node.static) return code

  for (const [key, child] of Object.entries(node.static)) {
    if (!child?.methods) continue

    for (const method in child.methods) {
      const entries = child.methods[method]
      if (!entries) continue
      for (const entry of entries) {
        const d = addRef(refs, entry.data)
        const g = method ? `m===${JSON.stringify(method)}&&` : ''

        let charCheck: string
        if (key.length <= 3) {
          const checks: string[] = []
          for (let c = 0; c < key.length; c++) {
            checks.push(`p.charCodeAt(${p1EndVar}+${1 + staticKeyLen + 1 + c})===${key.charCodeAt(c)}`)
          }
          charCheck = checks.join('&&')
        } else {
          charCheck = `p.charCodeAt(${p1EndVar}+${1 + staticKeyLen + 1})===${key.charCodeAt(0)}&&p.charCodeAt(${p1EndVar}+${1 + staticKeyLen + key.length})===${key.charCodeAt(key.length - 1)}`
        }

        const endPos = `${p1EndVar}+${1 + staticKeyLen + 1 + key.length}`

        if (entry.paramMap?.length) {
          const names = entry.paramMap.map(pm => pmName(pm))
          const {po, ro} = allocP(pre, uid, entry.paramMap)
          code += `if(${g}${charCheck}&&p.length===${endPos}){`
          code += `${po}${safe(names[0]!)}=p.slice(${p1Start},${p1EndVar});`
          code += `${ro}.data=$${d};return ${ro}}`
        } else {
          code += `if(${g}${charCheck}&&p.length===${endPos}){_rs.data=$${d};return _rs}`
        }
      }
    }
  }

  return code
}

// ── Deep wildcard ────────────────────────────────────

function emitDeepWildcard(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  p1Start: number,
  p1EndVar: string,
  staticKeyLen: number,
): string {
  let code = ''
  const wcStart = `${p1EndVar}+${1 + staticKeyLen + 1}`

  for (const m in methods) {
    const entry = methods[m]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const g = m ? `if(m===${JSON.stringify(m)})` : ''
    if (entry.paramMap?.length) {
      const names = entry.paramMap.map(pm => pmName(pm))
      const {po, ro} = allocP(pre, uid, entry.paramMap)
      let asgn = `${po}${safe(names[0]!)}=p.slice(${p1Start},${p1EndVar});`
      if (names.length > 1) {
        asgn += `${po}${safe(names[names.length - 1]!)}=p.slice(${wcStart});`
      }
      code += `${g}{${asgn}${ro}.data=$${d};return ${ro}}`
    } else {
      code += `${g}{_rs.data=$${d};return _rs}`
    }
  }
  return code
}

// ── Deep param chain: /:a/:b ─────────────────────────

function emitDeepParamChain(
  node: RouteNode<any>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  p1Start: number,
  p1EndVar: string,
): string {
  let code = ''
  if (!node.methods) return code

  for (const method in node.methods) {
    const entries = node.methods[method]
    if (!entries) continue
    for (const entry of entries) {
      if (!entry.paramMap?.length) continue
      const d = addRef(refs, entry.data)
      const g = method ? `m===${JSON.stringify(method)}&&` : ''
      const p2Start = `${p1EndVar}+1`

      if (entry.catchAll) {
        const names = entry.paramMap.map(pm => pmName(pm))
        const {po, ro} = allocP(pre, uid, entry.paramMap)
        let asgn = `${po}${safe(names[0]!)}=p.slice(${p1Start},${p1EndVar});`
        if (names.length > 1) {
          asgn += `${po}${safe(names[names.length - 1]!)}=p.slice(${p2Start});`
        }
        code += `if(${g}p.length>${p2Start}){${asgn}${ro}.data=$${d};return ${ro}}`
        continue
      }

      const names = entry.paramMap.map(pm => pmName(pm))
      const {po, ro} = allocP(pre, uid, entry.paramMap)
      code += `if(${g}p.indexOf("/",${p2Start})===-1&&p.length>${p2Start}){`
      code += `${po}${safe(names[0]!)}=p.slice(${p1Start},${p1EndVar});`
      code += `${po}${safe(names[1]!)}=p.slice(${p2Start});`
      code += `${ro}.data=$${d};return ${ro}}`
    }
  }

  return code
}

// ── Wildcard ─────────────────────────────────────────

function emitWildcard(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
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
      const {po, ro} = allocP(pre, uid, [[0, nm, false]])
      code += `${g}{${po}${safe(nm)}=p.length>=${offset}?p.slice(${offset}):"";${ro}.data=$${d};return ${ro}}`
    } else {
      code += `${g}{_rs.data=$${d};return _rs}`
    }
  }
  return code
}

// ── Terminal ─────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────

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

function pmName(pm: [number, string | RegExp, boolean]): string {
  return typeof pm[1] === 'string' ? pm[1] : String(pm[1])
}

/** Generate property access — dot notation for valid identifiers, bracket for others */
function propAccess(obj: string, k: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(k) ? `${obj}.${k}` : `${obj}[${JSON.stringify(k)}]`
}

/** @deprecated use propAccess */
function safe(k: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`
}

function addRef(refs: unknown[], v: unknown): number {
  let i = refs.indexOf(v)
  if (i === -1) { refs.push(v); i = refs.length - 1 }
  return i
}
