/**
 * Remove a route from the router.
 *
 * Handles all patterns: static, params, wildcards, modifiers, groups.
 */

import { splitPath, isParam, isCatchAll } from './utils.ts'

import type { RouterContext, RouteNode } from './types.ts'

/**
 * Remove a route by method and path.
 * Supports the same patterns as addRoute: modifiers (:name?, :name+, :name*),
 * non-capturing groups ({s}?), wildcard patterns (*.png), etc.
 */
export function removeRoute<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
): void {
  // Handle non-capturing groups: expand and remove each variant
  const groupMatch = path.match(/\{([^}]+)\}\?/)
  if (groupMatch) {
    const before = path.slice(0, groupMatch.index!)
    const content = groupMatch[1]!
    const after = path.slice(groupMatch.index! + groupMatch[0].length)
    removeRoute(ctx, method, before + content + after)
    removeRoute(ctx, method, before + after)
    return
  }

  // Handle modifiers: :name?, :name+, :name*
  const modSegments = path.split('/')
  for (let i = 0; i < modSegments.length; i++) {
    const seg = modSegments[i]!
    const m = seg.match(/^(.*:[\w-]+(?:\([^)]*\))?)([?+*])$/)
    if (!m) continue

    const pre = modSegments.slice(0, i).filter(Boolean)
    const suf = modSegments.slice(i + 1)
    const modifier = m[2]!
    const baseName = m[1]!.match(/:([\w-]+)/)?.[1] || '_'

    if (modifier === '?') {
      if (i < modSegments.length - 1) {
        removeRoute(ctx, method, '/' + pre.concat(m[1]!).concat(suf).join('/'))
        removeRoute(ctx, method, '/' + pre.concat(suf).join('/'))
      } else {
        // Terminal optional — remove from param node and parent
        _removeNode(ctx, method, '/' + pre.concat(m[1]!).join('/'))
        _removeNode(ctx, method, '/' + pre.join('/'))
      }
      return
    }
    if (modifier === '+') {
      removeRoute(ctx, method, '/' + [...pre, `**:${baseName}`, ...suf].join('/'))
      return
    }
    if (modifier === '*') {
      removeRoute(ctx, method, '/' + [...pre, `**:${baseName}`, ...suf].join('/'))
      removeRoute(ctx, method, '/' + [...pre, ...suf].join('/'))
      return
    }
  }

  _removeNode(ctx, method, path)
}

function _removeNode<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
): void {
  const segments = splitPath(path)
  let node: RouteNode<T> | undefined = ctx.root
  let isStatic = true

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!

    if (isCatchAll(segment)) {
      node = node.wildcard
      isStatic = false
      break
    }

    if (segment === '*' || isParam(segment) || (segment.includes('*') && !segment.startsWith('**'))) {
      node = node.param
      isStatic = false
      if (!node) return
      continue
    }

    if (!node.static?.[segment]) return
    node = node.static[segment]!
  }

  if (!node?.methods) return

  const key = method || ''
  const entries = node.methods[key]
  if (!entries) return

  if (isStatic && entries.length > 1) {
    // Static route shares node with wildcard zero-match — only remove static entries
    node.methods[key] = entries.filter(e => e.paramMap?.length)
    if (node.methods[key]!.length === 0) delete node.methods[key]
  } else {
    delete node.methods[key]
  }

  if (Object.keys(node.methods).length === 0) {
    node.methods = undefined
  }

  // Remove from static cache
  const normalized = '/' + segments.join('/')
  delete ctx.static[normalized]
  delete ctx.static[normalized + '/']
}
