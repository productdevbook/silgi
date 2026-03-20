/**
 * Add a route to the router.
 *
 * Supports all rou3 patterns:
 * - Static: `/users/list`
 * - Params: `/users/:id`
 * - Regex params: `/users/:id(\\d+)`
 * - Unnamed regex: `/path/(\\d+)`
 * - Wildcards: `/files/**`, `/files/**:rest`
 * - Single wildcard: `/blog/*`
 * - Wildcard patterns: `/files/*.png`, `/files/file-*-*.png`
 * - Optional: `/users/:id?`, `/api/:version?/users`
 * - One-or-more: `/files/:path+`
 * - Zero-or-more: `/files/:path*`
 * - Non-capturing groups: `/book{s}?`, `/blog/:id(\\d+){-:title}?`, `/foo{/bar}?`
 * - Mixed params: `/npm/@:param1/:param2`
 * - Escaped: `/static\\:path/\\*`
 */

import { splitPath, isCatchAll } from './utils.ts'

import type { RouterContext, RouteNode, MethodEntry, ParamMapEntry } from './types.ts'

export function addRoute<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
  data: T,
): void {
  // Handle escape sequences: \: → FFFD_A, \* → FFFD_B, \( → FFFD_C etc.
  // Only detect escapes for known sequences — \d, \w etc in regex are NOT escapes
  const hasEscapes = /\\[:\*\(\)\{\}]/.test(path)
  if (hasEscapes) {
    path = path
      .replace(/\\:/g, '\uFFFDA')
      .replace(/\\\*/g, '\uFFFDB')
      .replace(/\\\(/g, '\uFFFDC')
      .replace(/\\\)/g, '\uFFFDD')
      .replace(/\\\{/g, '\uFFFDE')
      .replace(/\\\}/g, '\uFFFDF')
  }

  // Handle non-capturing groups: {s}?, {-:title}?, {/bar}?
  // Expand into multiple routes
  const expanded = expandGroups(path)
  if (expanded) {
    for (const p of expanded) {
      addRoute(ctx, method, hasEscapes ? p : p, data)
    }
    return
  }

  // Handle modifiers: :name?, :name+, :name*
  const modExpanded = expandModifiers(path)
  if (modExpanded) {
    for (const p of modExpanded) {
      addRoute(ctx, method, p, data)
    }
    return
  }

  const segments = splitPath(path)
  const paramMap: ParamMapEntry[] = []
  const paramRegex: RegExp[] = []
  let hasRegex = false
  let isStatic = true

  let node = ctx.root

  for (let i = 0; i < segments.length; i++) {
    let segment = segments[i]!

    // Decode escape sequences back for static segments
    if (hasEscapes) {
      segment = decodeEscapes(segment)
      segments[i] = segment
    }

    // Catch-all wildcard: ** or **:name
    if (isCatchAll(segment)) {
      isStatic = false
      if (!node.wildcard) node.wildcard = { key: '**' }
      node = node.wildcard
      if (segment.length > 2 && segment.charCodeAt(2) === 58) {
        paramMap.push([i, segment.slice(3), false])
      } else {
        paramMap.push([i, '_', false])
      }
      break
    }

    // Single wildcard: * or *.ext or file-*-*.png
    if (segment === '*' || (segment.includes('*') && !segment.startsWith('**'))) {
      isStatic = false
      if (segment === '*') {
        _setMethod(node, method, data, [...paramMap], [...paramRegex], hasRegex, false)
      }
      if (!node.param) node.param = { key: '*' }
      node = node.param
      paramMap.push([i, String(paramMap.length), true])

      if (segment !== '*') {
        // Segment wildcard pattern: *.png → /^([^/]+?)\.png$/
        const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, (c) => c === '*' ? '([^/]+?)' : `\\${c}`)
        const regex = new RegExp(`^${escaped}$`)
        paramRegex[i] = regex
        hasRegex = true
      }
      continue
    }

    // Unnamed regex group: (\\d+), (png|jpg|gif)
    if (segment.startsWith('(') && segment.endsWith(')')) {
      isStatic = false
      if (!node.param) node.param = { key: '*' }
      node = node.param
      const pattern = segment.slice(1, -1)
      paramMap.push([i, String(paramMap.length), false])
      paramRegex[i] = new RegExp(`^${pattern}$`)
      hasRegex = true
      node.hasRegex = true
      continue
    }

    // Param: :name, :name(regex), @:name
    if (segment.includes(':') && !hasEscapes) {
      isStatic = false

      // Handle mixed segments like @:param1 or :id,name=:name.txt
      if (segment.charCodeAt(0) !== 58 || segment.indexOf(':', 1) !== -1) {
        // Complex segment with mixed static+param — use regex
        if (!node.param) node.param = { key: '*' }
        node = node.param
        const { regex, names } = parseMixedSegment(segment)
        paramMap.push([i, regex, false])
        paramRegex[i] = new RegExp(`^${regex.source}$`)
        hasRegex = true
        node.hasRegex = true
        // Store param names in regex named groups
        for (const name of names) {
          paramMap.push([i, name, false])
        }
        // Remove the regex entry, keep only named entries
        paramMap.splice(paramMap.length - names.length - 1, 1)
        continue
      }

      // Simple param: :name or :name(regex)
      let paramSeg = segment.slice(1)

      if (!node.param) node.param = { key: '*' }

      // Check for modifier at end
      if (paramSeg.endsWith('+')) {
        if (!node.wildcard) node.wildcard = { key: '**' }
        node = node.wildcard
        paramMap.push([i, paramSeg.slice(0, -1), false])
        break
      }
      if (paramSeg.endsWith('*')) {
        if (!node.wildcard) node.wildcard = { key: '**' }
        node = node.wildcard
        paramMap.push([i, paramSeg.slice(0, -1), true])
        break
      }

      let optional = false
      if (paramSeg.endsWith('?')) {
        optional = true
        paramSeg = paramSeg.slice(0, -1)
        _setMethod(node, method, data, [...paramMap], [...paramRegex], hasRegex, false)
      }

      node = node.param

      // Check for regex constraint
      const parenIdx = paramSeg.indexOf('(')
      if (parenIdx !== -1) {
        const name = paramSeg.slice(0, parenIdx)
        const pattern = paramSeg.slice(parenIdx + 1, -1)
        paramMap.push([i, name, optional])
        paramRegex[i] = new RegExp(`^${pattern}$`)
        hasRegex = true
        node.hasRegex = true
      } else {
        paramMap.push([i, paramSeg, optional])
      }
      continue
    }

    // Static segment
    if (!node.static) node.static = Object.create(null)
    if (!node.static![segment]) node.static![segment] = { key: segment }
    node = node.static![segment]!
  }

  _setMethod(node, method, data, paramMap, paramRegex, hasRegex, !isStatic && _lastIsCatchAll(segments))

  if (isStatic) {
    const normalized = '/' + segments.join('/')
    ctx.static[normalized] = node
    if (normalized.length > 1) {
      ctx.static[normalized + '/'] = node
    }
  }
}

// ── Non-capturing groups ────────────────────────────

function expandGroups(path: string): string[] | null {
  // Match {content}? pattern
  const match = path.match(/\{([^}]+)\}\?/)
  if (!match) return null

  const before = path.slice(0, match.index!)
  const content = match[1]!
  const after = path.slice(match.index! + match[0].length)

  // Two variants: with and without the group content
  const withGroup = before + content + after
  const withoutGroup = before + after

  return [withGroup, withoutGroup]
}

// ── Modifier expansion ──────────────────────────────

function expandModifiers(path: string): string[] | null {
  const segments = path.split('/')
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const m = seg.match(/^(.*:[\w-]+(?:\([^)]*\))?)([?])$/)
    if (!m) continue
    // Only handle optional mid-path (not at end — end is handled inline)
    if (i < segments.length - 1) {
      const pre = segments.slice(0, i)
      const suf = segments.slice(i + 1)
      const withParam = pre.concat(m[1]!).concat(suf).join('/')
      const withoutParam = pre.concat(suf).join('/')
      return [withParam, withoutParam]
    }
  }
  return null
}

// ── Mixed segment parser ────────────────────────────

function parseMixedSegment(segment: string): { regex: RegExp; names: string[] } {
  const names: string[] = []
  let pattern = ''
  let i = 0

  while (i < segment.length) {
    if (segment[i] === ':') {
      // Find param name end
      let j = i + 1
      while (j < segment.length && /[\w-]/.test(segment[j]!)) j++

      // Check for regex constraint
      if (j < segment.length && segment[j] === '(') {
        const end = segment.indexOf(')', j)
        const name = segment.slice(i + 1, j)
        const constraint = segment.slice(j + 1, end)
        names.push(name)
        pattern += `(?<${name.replace(/-/g, '_')}>${constraint})`
        i = end + 1
      } else {
        const name = segment.slice(i + 1, j)
        names.push(name)
        pattern += `(?<${name.replace(/-/g, '_')}>[^/]+?)`
        i = j
      }
    } else {
      // Escape regex special chars
      pattern += segment[i]!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      i++
    }
  }

  return { regex: new RegExp(pattern), names }
}

// ── Escape handling ─────────────────────────────────

function decodeEscapes(segment: string): string {
  return segment
    .replace(/\uFFFDA/g, ':')
    .replace(/\uFFFDB/g, '*')
    .replace(/\uFFFDC/g, '(')
    .replace(/\uFFFDD/g, ')')
    .replace(/\uFFFDE/g, '{')
    .replace(/\uFFFDF/g, '}')
}

// ── Helpers ─────────────────────────────────────────

function _setMethod<T>(
  node: RouteNode<T>,
  method: string,
  data: T,
  paramMap: ParamMapEntry[],
  paramRegex: RegExp[],
  hasRegex: boolean,
  catchAll: boolean,
): void {
  if (!node.methods) node.methods = Object.create(null)
  const entry: MethodEntry<T> = {
    data,
    paramMap: paramMap.length > 0 ? paramMap : undefined,
    paramRegex,
    catchAll: catchAll || undefined,
  }
  if (hasRegex) node.hasRegex = true
  const key = method || ''
  if (!node.methods![key]) node.methods![key] = []
  node.methods![key]!.push(entry)
}

function _lastIsCatchAll(segments: string[]): boolean {
  if (segments.length === 0) return false
  const last = segments[segments.length - 1]!
  return last === '**' || last.startsWith('**:') || last.endsWith('+') || last.endsWith('*')
}
