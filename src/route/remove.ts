/**
 * Remove a route from the router.
 */

import { splitPath, isParam, isCatchAll } from './utils.ts'

import type { RouterContext, RouteNode } from './types.ts'

/**
 * Remove a route by method and path.
 */
export function removeRoute<T>(
  ctx: RouterContext<T>,
  method: string,
  path: string,
): void {
  const segments = splitPath(path)
  let node = ctx.root

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!

    if (isCatchAll(segment)) {
      node = node.wildcard!
      break
    }

    if (segment === '*' || isParam(segment)) {
      if (!node.param) return
      node = node.param
      continue
    }

    if (!node.static?.[segment]) return
    node = node.static[segment]!
  }

  if (!node.methods) return

  const key = method || ''
  delete node.methods[key]

  // Clean up empty methods
  if (Object.keys(node.methods).length === 0) {
    node.methods = undefined
  }

  // Remove from static cache
  const normalized = '/' + segments.join('/')
  delete ctx.static[normalized]
  delete ctx.static[normalized + '/']
}
