/**
 * Add a route to the router.
 */

import { splitPath, isParam, isCatchAll, parseParam } from './utils.ts'

import type { RouterContext, RouteNode, MethodEntry, ParamMapEntry } from './types.ts'

/**
 * Add a route to the router context.
 *
 * Supports:
 * - Static: `/users/list`
 * - Params: `/users/:id`
 * - Regex params: `/users/:id(\\d+)`
 * - Wildcards: `/files/**`, `/files/**:rest`
 * - Single wildcard: `/blog/*`
 * - Optional: `/users/:id?`
 * - One-or-more: `/files/:path+`
 * - Zero-or-more: `/files/:path*`
 */
export function addRoute<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
  data: T,
): void {
  const segments = splitPath(path)
  const paramMap: ParamMapEntry[] = []
  const paramRegex: RegExp[] = []
  let hasRegex = false
  let isStatic = true

  let node = ctx.root

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!

    // Catch-all wildcard: ** or **:name
    if (isCatchAll(segment)) {
      isStatic = false
      if (!node.wildcard) node.wildcard = { key: '**' }
      node = node.wildcard

      // Named catch-all: **:name
      if (segment.length > 2 && segment.charCodeAt(2) === 58) {
        const name = segment.slice(3)
        paramMap.push([i, name, false])
      } else {
        paramMap.push([i, '_', false])
      }
      break
    }

    // Single wildcard: * or *.ext
    if (segment === '*' || (segment.includes('*') && !segment.startsWith('**'))) {
      isStatic = false
      if (!node.param) node.param = { key: '*' }
      node = node.param
      // Unnamed wildcard uses numeric index
      paramMap.push([i, String(paramMap.length), false])

      // Segment wildcard pattern (*.png, file-*-*.png)
      if (segment !== '*') {
        const pattern = segment.replace(/\*/g, '([^/]+?)')
        const regex = new RegExp(`^${pattern}$`)
        paramRegex[i] = regex
        hasRegex = true
      }
      continue
    }

    // Param: :name, :name(regex), :name?, :name+, :name*
    if (isParam(segment)) {
      isStatic = false
      const parsed = parseParam(segment)

      if (!node.param) node.param = { key: '*' }

      // Modifiers: + (one-or-more), * (zero-or-more)
      if (parsed.modifier === '+' || parsed.modifier === '*') {
        if (!node.wildcard) node.wildcard = { key: '**' }
        node = node.wildcard
        paramMap.push([i, parsed.name, parsed.modifier === '*'])
        break
      }

      // Optional param: :name?
      if (parsed.optional) {
        // Add route at current node too (matches without this segment)
        _setMethod(node, method, data, [...paramMap], [...paramRegex], hasRegex)
      }

      node = node.param
      paramMap.push([i, parsed.name, parsed.optional])

      if (parsed.regex) {
        paramRegex[i] = parsed.regex
        hasRegex = true
        node.hasRegex = true
      }
      continue
    }

    // Static segment
    if (!node.static) node.static = Object.create(null)
    if (!node.static![segment]) node.static![segment] = { key: segment }
    node = node.static![segment]!
  }

  _setMethod(node, method, data, paramMap, paramRegex, hasRegex, !isStatic && _lastIsCatchAll(segments))

  // Cache fully static routes for O(1) lookup
  if (isStatic) {
    const normalized = '/' + segments.join('/')
    ctx.static[normalized] = node
    // Also cache without trailing slash
    if (normalized.length > 1) {
      ctx.static[normalized + '/'] = node
    }
  }
}

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

/** Check if the last segment is a catch-all pattern */
function _lastIsCatchAll(segments: string[]): boolean {
  if (segments.length === 0) return false
  const last = segments[segments.length - 1]!
  return last === '**' || last.startsWith('**:') || last.endsWith('+') || last.endsWith('*')
}
