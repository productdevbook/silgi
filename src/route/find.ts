/**
 * Find a route by method and path — zero-allocation hot path.
 *
 * Static routes: direct property access (O(1))
 * Dynamic routes: index-based string traversal (no split/array)
 */

import type { RouterContext, RouteNode, MethodEntry, MatchedRoute, ParamMapEntry } from './types.ts'

/**
 * Find a matching route for a given method and path.
 */
export function findRoute<T>(
  ctx: RouterContext<T>,
  method: string = '',
  path: string,
): MatchedRoute<T> | undefined {
  // Normalize trailing slash
  const len = path.length
  if (len > 1 && path.charCodeAt(len - 1) === 47) {
    path = path.slice(0, -1)
  }

  // Fast path: static route cache
  const staticNode = ctx.static[path]
  if (staticNode?.methods) {
    const entries = staticNode.methods[method] || staticNode.methods['']
    if (entries) return { data: entries[0]!.data }
  }

  // Segment-by-segment tree traversal
  // We still need segments for param extraction, but collect lazily
  const segments: string[] = []
  let pos = path.charCodeAt(0) === 47 ? 1 : 0
  const end = path.length

  // Extract segments while traversing
  while (pos < end) {
    const nextSlash = path.indexOf('/', pos)
    const segEnd = nextSlash === -1 ? end : nextSlash
    segments.push(path.slice(pos, segEnd))
    pos = segEnd + 1
  }

  if (segments.length === 0 && path === '/') {
    // Root path — check root node
    if (ctx.root.methods) {
      const entries = ctx.root.methods[method] || ctx.root.methods['']
      if (entries) return { data: entries[0]!.data }
    }
    return undefined
  }

  const match = _lookup(ctx.root, method, segments, 0)
  if (!match) return undefined

  if (match.paramMap) {
    return { data: match.data, params: _extractParams(segments, match.paramMap, match.catchAll) }
  }
  return { data: match.data }
}

function _lookup<T>(
  node: RouteNode<T>,
  method: string,
  segments: string[],
  index: number,
): MethodEntry<T> | undefined {
  if (index === segments.length) {
    // Check current node
    if (node.methods) {
      const entries = node.methods[method] || node.methods['']
      if (entries) return entries[0]
    }
    // Optional param fallback
    if (node.param?.methods) {
      const entries = node.param.methods[method] || node.param.methods['']
      if (entries?.[0]?.paramMap?.[entries[0].paramMap.length - 1]?.[2]) return entries[0]
    }
    // Wildcard fallback (** matches zero segments)
    if (node.wildcard?.methods) {
      const entries = node.wildcard.methods[method] || node.wildcard.methods['']
      if (entries) return entries[0]
    }
    return undefined
  }

  const segment = segments[index]!

  // 1. Static child (highest priority, fastest)
  const staticChild = node.static?.[segment]
  if (staticChild) {
    const match = _lookup(staticChild, method, segments, index + 1)
    if (match) return match
  }

  // 2. Param child
  if (node.param) {
    const match = _lookup(node.param, method, segments, index + 1)
    if (match) {
      // Regex constraint check
      if (node.param.hasRegex && match.paramRegex[index]) {
        if (!match.paramRegex[index]!.test(segment)) {
          // Try unconstrained fallback at same node
          if (index + 1 === segments.length && node.param.methods) {
            const entries = node.param.methods[method] || node.param.methods['']
            if (entries) {
              for (let e = 0; e < entries.length; e++) {
                const entry = entries[e]!
                if (!entry.paramRegex[index] || entry.paramRegex[index]!.test(segment)) return entry
              }
            }
          }
          return undefined
        }
      }
      return match
    }
  }

  // 3. Wildcard catch-all
  if (node.wildcard?.methods) {
    const entries = node.wildcard.methods[method] || node.wildcard.methods['']
    if (entries) return entries[0]
  }

  return undefined
}

function _extractParams(
  segments: string[],
  paramMap: ParamMapEntry[],
  catchAll?: boolean,
): Record<string, string> {
  const params: Record<string, string> = Object.create(null)
  for (let i = 0; i < paramMap.length; i++) {
    const [idx, name] = paramMap[i]!
    const paramName = typeof name === 'string' ? name : String(i)
    if (idx >= segments.length) continue

    // Catch-all: join remaining segments
    if (catchAll && i === paramMap.length - 1) {
      params[paramName] = segments.slice(idx).join('/')
      continue
    }
    params[paramName] = segments[idx]!
  }
  return params
}
