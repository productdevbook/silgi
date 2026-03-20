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

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute, ParamMapEntry } from './types.ts'

export function compileRouter<T>(ctx: RouterContext<T>): (method: string, path: string) => MatchedRoute<T> | undefined {
  const refs: unknown[] = []
  const pre: string[] = ['var _rs={data:null,params:null}']
  const uid = { n: 0 }

  const sw = emitSwitch(ctx, refs)

  const hasRoutes = sw || ctx.root.static || ctx.root.param || ctx.root.wildcard
  if (!hasRoutes) return () => undefined

  // Each first-char group gets its own branch function
  let branchDefs = ''
  const dispatchCases: string[] = []

  if (ctx.root.static) {
    const byChar = new Map<number, Array<[string, RouteNode<any>]>>()
    for (const [key, child] of Object.entries(ctx.root.static)) {
      if (!child) continue
      const ch = key.charCodeAt(0)
      if (!byChar.has(ch)) byChar.set(ch, [])
      byChar.get(ch)!.push([key, child])
    }

    for (const [ch, entries] of byChar) {
      // Check if ALL entries in this group are simple leaves (indexOf fast path)
      const allSimple = entries.every(
        ([, child]) =>
          !child.static &&
          !(child.param && child.wildcard) &&
          !child.param?.static &&
          !child.param?.param &&
          !child.param?.wildcard &&
          !_hasMultiParam(child.param),
      )

      let body: string
      let hasContent = false

      if (allSimple) {
        // indexOf fast path — zero allocation for all entries
        body = 'var _i=p.indexOf("/",1);if(_i===-1)_i=p.length;'
        let innerIf = false

        for (const [key, child] of entries) {
          const kl = key.length
          const prefixEnd = 1 + kl
          const childPrefix = prefixEnd + 1

          let segCheck: string
          if (entries.length === 1 && kl <= 6) {
            segCheck = `_i===${prefixEnd}`
            for (let c = 1; c < kl; c++) {
              segCheck += `&&p.charCodeAt(${1 + c})===${key.charCodeAt(c)}`
            }
          } else {
            segCheck = `_i===${prefixEnd}&&p.substring(1,${prefixEnd})===${JSON.stringify(key)}`
          }

          let inner = ''
          const inSwitch = !!ctx.static['/' + key]

          if (child.methods && !inSwitch) {
            let hasParams = false
            for (const m in child.methods) {
              if (child.methods[m]?.some((e: MethodEntry<any>) => e.paramMap?.length)) {
                hasParams = true
                break
              }
            }
            if (!hasParams) {
              inner += emitTerminal(child.methods, refs, `p.length===${prefixEnd}`)
            }
          }

          if (child.param?.methods) {
            for (const method in child.param.methods) {
              const pentries = child.param.methods[method]
              if (!pentries) continue
              for (const entry of pentries) {
                if (!entry.paramMap?.length) continue
                const d = addRef(refs, entry.data)
                const g = method ? `m===${JSON.stringify(method)}&&` : ''
                const { po, ro } = allocP(pre, uid, entry.paramMap, entry)

                if (entry.catchAll) {
                  const pn = pmName(entry.paramMap[0]!)
                  const lastPm = entry.paramMap[entry.paramMap.length - 1]!
                  const zeroOk = lastPm[2] || lastPm[1] === '_'
                  if (zeroOk) {
                    inner += `if(${g}p.length>=${prefixEnd}){${po}${safe(pn)}=p.length>${prefixEnd}?p.substring(${childPrefix}):"";${ro}.data=$${d};return ${ro}}`
                  } else {
                    inner += `if(${g}p.length>${childPrefix}){${po}${safe(pn)}=p.substring(${childPrefix});${ro}.data=$${d};return ${ro}}`
                  }
                  continue
                }

                if (entry.paramMap.length === 1) {
                  let rx = ''
                  for (let r = 0; r < (entry.paramRegex?.length || 0); r++) {
                    if (entry.paramRegex[r]) {
                      const ri = addRef(refs, entry.paramRegex[r])
                      rx += `&&$${ri}.test(p.substring(${childPrefix}))`
                    }
                  }
                  inner +=
                    `{var _j=p.indexOf("/",${childPrefix});if(${g}p.length>${childPrefix}&&_j===-1${rx}){` +
                    emitAssign(po, entry.paramMap[0]!, `p.substring(${childPrefix})`, entry.paramRegex, refs, uid) +
                    `${ro}.data=$${d};return ${ro}}}`
                }
              }
            }
          }

          if (child.wildcard?.methods) {
            inner += emitWildcardSlice(child.wildcard.methods, refs, pre, uid, childPrefix)
          }

          if (!inner) continue
          body += `${innerIf ? 'else ' : ''}if(${segCheck}){${inner}}`
          innerIf = true
          hasContent = true
        }
      } else {
        // Complex tree — use split
        body = 'var s=p.split("/"),l=s.length;'
        let innerIf = false
        for (const [key, child] of entries) {
          const childPrefix = 1 + key.length + 1
          const inSwitch = !!ctx.static['/' + key]
          const nodeCode = emitNode(child, refs, pre, uid, 2, childPrefix, inSwitch)
          if (!nodeCode) continue
          body += `${innerIf ? 'else ' : ''}if(s[1]===${JSON.stringify(key)}){${nodeCode}}`
          innerIf = true
          hasContent = true
        }
      }

      if (hasContent) {
        const bn = `_b${uid.n++}`
        branchDefs += `var ${bn}=function(m,p){${body}};`
        dispatchCases.push(`case ${ch}:{var _t=${bn}(m,p);if(_t)return _t}break;`)
      }
    }
  }

  // Root-level param
  let rootParam = ''
  if (ctx.root.param) {
    const paramCode = emitParamNode(ctx.root.param, refs, pre, uid, 1)
    if (paramCode) {
      const bn = `_b${uid.n++}`
      branchDefs += `var ${bn}=function(m,p){var s=p.split("/"),l=s.length;${paramCode}};`
      rootParam = `{var _t=${bn}(m,p);if(_t)return _t}`
    }
  }

  // Root-level wildcard
  let rootWild = ''
  if (ctx.root.wildcard?.methods) {
    rootWild = emitWildcardSlice(ctx.root.wildcard.methods, refs, pre, uid, 1)
  }

  // Build dispatch: switch on charCodeAt(1) instead of if-else chain
  let dispatch = ''
  if (dispatchCases.length > 0) {
    dispatch = `switch(p.charCodeAt(1)){${dispatchCases.join('')}}`
  }
  dispatch += rootParam + rootWild

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
    // Group all methods under one case — trailing slash already normalized
    let checks = ''
    for (const m in node.methods) {
      const e = node.methods[m]?.[0]
      if (!e) continue
      const d = addRef(refs, e.data)
      checks += m ? `if(m===${JSON.stringify(m)}){_rs.data=$${d};return _rs}` : `{_rs.data=$${d};return _rs}`
    }
    if (checks) cases.push(`case ${JSON.stringify(norm)}:${checks}break;`)
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
  skipStaticTerminal?: boolean, // true when static terminal is already in switch
): string {
  let code = ''

  // Terminal: this node has handlers
  if (node.methods) {
    let hasParams = false
    for (const m in node.methods) {
      if (node.methods[m]?.some((e: MethodEntry<any>) => e.paramMap?.length)) {
        hasParams = true
        break
      }
    }
    if (hasParams) {
      code += emitParamTerminal(node.methods, refs, pre, uid, depth)
    } else if (!skipStaticTerminal) {
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
        const { po, ro } = allocP(pre, uid, entry.paramMap, entry)

        if (entry.catchAll) {
          const pn = pmName(entry.paramMap[0]!)
          code += `if(${g}l>=${depth + 1}){${po}${safe(pn)}=s.slice(${depth}).join("/");${ro}.data=$${d};return ${ro}}`
          continue
        }

        const pc = entry.paramMap.length
        const lastOpt = entry.paramMap[pc - 1]![2]
        const lastIdx = entry.paramMap[pc - 1]![0]
        const expLen = lastIdx + 2

        const lenCk = lastOpt ? `(l===${expLen}||l===${expLen - 1})` : `l===${expLen}`

        // Regex constraints (only .test for non-group regexes)
        let rx = ''
        for (let i = 0; i < (entry.paramRegex?.length || 0); i++) {
          if (entry.paramRegex[i]) {
            const pmI = entry.paramMap.findIndex(([idx]) => idx === i)
            if (pmI !== -1) {
              const src = entry.paramRegex[i]!.source
              // Skip .test for regexes with capture groups — handled by emitAssign
              if (!src.includes('(?<') && !src.match(/\((?!\?)/g)?.length) {
                rx += `&&${entry.paramRegex[i]!.toString()}.test(s[${entry.paramMap[pmI]![0] + 1}])`
              } else {
                rx += `&&${entry.paramRegex[i]!.toString()}.test(s[${entry.paramMap[pmI]![0] + 1}])`
              }
            }
          }
        }

        // Assign params — use regex extraction when needed
        let asgn = ''
        for (let i = 0; i < pc; i++) {
          asgn += emitAssign(po, entry.paramMap[i]!, `s[${entry.paramMap[i]![0] + 1}]`, entry.paramRegex, refs, uid)
        }

        code += `if(${g}${lenCk}${rx}){${asgn}${ro}.data=$${d};return ${ro}}`
      }
    }
  }

  // Recurse into children — create a virtual node WITHOUT methods
  // to avoid re-emitting terminal handlers that were already handled above
  if (node.static || node.param || node.wildcard) {
    const childNode = {
      key: node.key,
      static: node.static,
      param: node.param,
      wildcard: node.wildcard,
    } as RouteNode<any>
    code += emitNode(childNode, refs, pre, uid, depth + 1)
  }

  return code
}

// ── Param-aware terminal ────────────────────────────

function emitParamTerminal(
  methods: Record<string, MethodEntry<any>[] | undefined>,
  refs: unknown[],
  pre: string[],
  uid: { n: number },
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

      // Use depth for length check — depth is the split length at this node
      const pc = entry.paramMap.length
      const lastOpt = entry.paramMap[pc - 1]![2]
      const lenCk = lastOpt ? `(l===${depth}||l===${depth - 1})` : `l===${depth}`

      const { po, ro } = allocP(pre, uid, entry.paramMap, entry)
      let asgn = ''
      for (let i = 0; i < pc; i++) {
        asgn += emitAssign(po, entry.paramMap[i]!, `s[${entry.paramMap[i]![0] + 1}]`, entry.paramRegex, refs, uid)
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

function emitTerminal(methods: Record<string, MethodEntry<any>[] | undefined>, refs: unknown[], ck: string): string {
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
  refs: unknown[],
  pre: string[],
  uid: { n: number },
  depth: number,
): string {
  let code = ''
  for (const m in methods) {
    const entry = methods[m]?.[0]
    if (!entry) continue
    const d = addRef(refs, entry.data)
    const g = m ? `if(m===${JSON.stringify(m)})` : ''
    if (entry.paramMap?.length) {
      const { po, ro } = allocP(pre, uid, entry.paramMap)
      const lastPm = entry.paramMap[entry.paramMap.length - 1]!
      const zeroOk = lastPm[2] || lastPm[1] === '_'
      let asgn = ''
      for (let i = 0; i < entry.paramMap.length; i++) {
        const [si, nm] = entry.paramMap[i]!
        const pn = typeof nm === 'string' ? nm : String(i)
        if (i === entry.paramMap.length - 1 && entry.catchAll) {
          asgn += `${po}${safe(pn)}=s.slice(${depth}).join("/");`
        } else {
          asgn += `${po}${safe(pn)}=s[${si + 1}];`
        }
      }
      if (zeroOk) {
        code += `${g}{${asgn}${ro}.data=$${d};return ${ro}}`
      } else {
        code += `${g}if(l>${depth}){${asgn}${ro}.data=$${d};return ${ro}}`
      }
    } else {
      code += `${g}{_rs.data=$${d};return _rs}`
    }
  }
  return code
}

// ── Wildcard (compile-time slice) ───────────────────

function emitWildcardSlice(
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
      const { po, ro } = allocP(pre, uid, entry.paramMap)
      const lastPn = pmName(entry.paramMap[entry.paramMap.length - 1]!)
      // For slice-based wildcard, only the last (catch-all) param uses p.slice
      // Earlier params need split — fall back to split if multiple params
      const lastEntry = entry.paramMap[entry.paramMap.length - 1]!
      const zeroOk = lastEntry[2] || lastEntry[1] === '_'
      if (entry.paramMap.length === 1) {
        if (zeroOk) {
          code += `${g}{${po}${safe(lastPn)}=p.length>=${offset}?p.slice(${offset}):"";${ro}.data=$${d};return ${ro}}`
        } else {
          code += `${g}if(p.length>${offset}){${po}${safe(lastPn)}=p.slice(${offset});${ro}.data=$${d};return ${ro}}`
        }
      } else {
        // Multiple params — need split for non-wildcard params
        let asgn = ''
        for (let i = 0; i < entry.paramMap.length; i++) {
          const [si, nm] = entry.paramMap[i]!
          const pn = typeof nm === 'string' ? nm : String(i)
          if (i === entry.paramMap.length - 1) {
            asgn += `${po}${safe(pn)}=p.length>=${offset}?p.slice(${offset}):"";`
          } else {
            asgn += `${po}${safe(pn)}=s[${si + 1}];`
          }
        }
        code += `${g}{var s=p.split("/");${asgn}${ro}.data=$${d};return ${ro}}`
      }
    } else {
      code += `${g}{_rs.data=$${d};return _rs}`
    }
  }
  return code
}

// ── Helpers ─────────────────────────────────────────

/** Collect all param names an entry will produce — accounts for regex groups */
function collectNames(entry: MethodEntry<any>): string[] {
  const pm = entry.paramMap
  if (!pm?.length) return []
  const names: string[] = []
  for (let i = 0; i < pm.length; i++) {
    const [si, nm] = pm[i]!
    const rx = entry.paramRegex?.[si]
    if (rx) {
      const src = rx.source
      if (src.includes('(?<')) {
        for (const m of src.matchAll(/\(\?<(\w+)>/g)) names.push(m[1]!)
        continue
      }
      const numGroups = (src.match(/\((?!\?)/g) || []).length
      if (numGroups > 1) {
        const base = parseInt(typeof nm === 'string' ? nm : String(nm))
        for (let g = 0; g < numGroups; g++) names.push(isNaN(base) ? String(g) : String(base + g))
        continue
      }
    }
    names.push(typeof nm === 'string' ? nm : String(nm))
  }
  return names
}

function allocP(
  pre: string[],
  uid: { n: number },
  pm: Array<[number, string | RegExp, boolean]> | Array<[number, string, boolean]>,
  entry?: MethodEntry<any>,
): { po: string; ro: string } {
  const idx = uid.n++
  const po = `_p${idx}`
  const ro = `_r${idx}`
  const fieldNames = entry ? collectNames(entry) : pm.map(([, n]) => (typeof n === 'string' ? n : String(n)))
  const fields = fieldNames.map((n) => `${JSON.stringify(n)}:""`).join(',')
  pre.push(`var ${po}={${fields}}`)
  pre.push(`var ${ro}={data:null,params:${po}}`)
  return { po, ro }
}

/** Emit param assignment — handles regex group extraction */
function emitAssign(
  po: string,
  pm: ParamMapEntry,
  segExpr: string,
  paramRegex: RegExp[] | undefined,
  refs: unknown[],
  uid: { n: number },
): string {
  const [si] = pm
  const pn = pmName(pm)
  const rx = paramRegex?.[si]
  if (!rx) return `${po}${safe(pn)}=${segExpr};`

  const src = rx.source
  const ri = addRef(refs, rx)
  const mv = `_m${uid.n++}`

  if (src.includes('(?<')) {
    const groupNames = [...src.matchAll(/\(\?<(\w+)>/g)].map((m) => m[1]!)
    let code = `var ${mv}=$${ri}.exec(${segExpr});`
    for (const gn of groupNames) code += `${po}${safe(gn)}=${mv}?${mv}.groups.${gn}:"";`
    return code
  }

  const numGroups = (src.match(/\((?!\?)/g) || []).length
  if (numGroups > 0) {
    const base = parseInt(pn)
    let code = `var ${mv}=$${ri}.exec(${segExpr});`
    for (let g = 0; g < numGroups; g++) {
      const gn = isNaN(base) ? pn : String(base + g)
      code += `${po}${safe(gn)}=${mv}?${mv}[${g + 1}]:"";`
    }
    return code
  }

  return `${po}${safe(pn)}=${segExpr};`
}

function _hasMultiParam(node: RouteNode<any> | undefined): boolean {
  if (!node?.methods) return false
  for (const m in node.methods) {
    if (node.methods[m]?.some((e) => e.paramMap && e.paramMap.length > 1)) return true
  }
  return false
}

function pmName(pm: [number, string | RegExp, boolean]): string {
  return typeof pm[1] === 'string' ? pm[1] : String(pm[1])
}

function safe(k: string): string {
  return /^[a-zA-Z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`
}

function addRef(refs: unknown[], v: unknown): number {
  let i = refs.indexOf(v)
  if (i === -1) {
    refs.push(v)
    i = refs.length - 1
  }
  return i
}
