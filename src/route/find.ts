/**
 * Find a route by method and path.
 *
 * Optimized lookup order:
 * 1. Static cache (Map O(1)) — most common case
 * 2. Radix tree traversal — params/wildcards
 */

import { splitPath } from './utils.ts'

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute, ParamMapEntry } from './types.ts'

/**
 * Find a matching route for a given method and path.
 *
 * Returns `{ data, params }` or `undefined` if no match.
 */
export function findRoute<T>(
  ctx: RouterContext<T>,
  method: string = '',
  path: string,
): MatchedRoute<T> | undefined {
  // Normalize trailing slash
  if (path.length > 1 && path.charCodeAt(path.length - 1) === 47) {
    path = path.slice(0, -1)
  }

  // Fast path: static route cache (O(1))
  const staticNode = ctx.static[path]
  if (staticNode?.methods) {
    const entries = staticNode.methods[method] || staticNode.methods['']
    if (entries) return { data: entries[0]!.data }
  }

  // Tree traversal
  const segments = splitPath(path)
  const match = _lookup(ctx.root, method, segments, 0)
  if (!match) return undefined

  // Extract params
  if (match.paramMap) {
    return {
      data: match.data,
      params: _extractParams(segments, match.paramMap),
    }
  }

  return { data: match.data }
}

function _lookup<T>(
  node: RouteNode<T>,
  method: string,
  segments: string[],
  index: number,
): MethodEntry<T> | undefined {
  // End of path
  if (index === segments.length) {
    if (node.methods) {
      const entries = node.methods[method] || node.methods['']
      if (entries) return entries[0]
    }
    // Fallback: optional param child
    if (node.param?.methods) {
      const entries = node.param.methods[method] || node.param.methods['']
      if (entries) {
        const e = entries[0]!
        if (e.paramMap?.[e.paramMap.length - 1]?.[2] /* optional */) return e
      }
    }
    // Fallback: wildcard child
    if (node.wildcard?.methods) {
      const entries = node.wildcard.methods[method] || node.wildcard.methods['']
      if (entries) {
        const e = entries[0]!
        if (e.paramMap?.[e.paramMap.length - 1]?.[2] /* optional */) return e
      }
    }
    return undefined
  }

  const segment = segments[index]!

  // 1. Static child
  if (node.static) {
    const child = node.static[segment]
    if (child) {
      const match = _lookup(child, method, segments, index + 1)
      if (match) return match
    }
  }

  // 2. Param child
  if (node.param) {
    const match = _lookup(node.param, method, segments, index + 1)
    if (match) {
      // Regex constraint check
      if (node.param.hasRegex && match.paramRegex[index]) {
        if (!match.paramRegex[index]!.test(segment)) {
          // Try next entry (unconstrained fallback)
          // Re-lookup to find unconstrained match
          const entries = _getEntries(node.param, method, segments, index + 1)
          if (entries) {
            for (const e of entries) {
              if (!e.paramRegex[index] || e.paramRegex[index]!.test(segment)) return e
            }
          }
          return undefined
        }
      }
      return match
    }
  }

  // 3. Wildcard child (catch-all)
  if (node.wildcard?.methods) {
    const entries = node.wildcard.methods[method] || node.wildcard.methods['']
    if (entries) return entries[0]
  }

  return undefined
}

/** Get all method entries at a terminal node */
function _getEntries<T>(
  node: RouteNode<T>,
  method: string,
  segments: string[],
  index: number,
): MethodEntry<T>[] | undefined {
  if (index === segments.length && node.methods) {
    return node.methods[method] || node.methods['']
  }
  return undefined
}

/** Extract params from segments using the param map */
function _extractParams(
  segments: string[],
  paramMap: ParamMapEntry[],
): Record<string, string> {
  const params: Record<string, string> = Object.create(null)
  for (let i = 0; i < paramMap.length; i++) {
    const [idx, name, _optional] = paramMap[i]!
    const paramName = typeof name === 'string' ? name : String(i)

    if (idx >= segments.length) continue

    // Last param entry with remaining segments → wildcard catch-all
    if (i === paramMap.length - 1 && idx < segments.length - 1) {
      params[paramName] = segments.slice(idx).join('/')
      continue
    }

    params[paramName] = segments[idx]!
  }
  return params
}
