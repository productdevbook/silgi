/**
 * Katman Router — High-performance radix tree router.
 *
 * Faster than rou3 for static routes (Map.get O(1)),
 * competitive for parametric/wildcard routes.
 *
 * @example
 * ```ts
 * import { createRouter, addRoute, findRoute } from 'katman/route'
 *
 * const router = createRouter()
 * addRoute(router, 'GET', '/users/:id', { handler: getUser })
 * addRoute(router, 'POST', '/users', { handler: createUser })
 *
 * const match = findRoute(router, 'GET', '/users/123')
 * // { data: { handler: getUser }, params: { id: '123' } }
 * ```
 */

export { createRouter } from './context.ts'
export { addRoute } from './add.ts'
export { findRoute } from './find.ts'
export { removeRoute } from './remove.ts'
export { compileRouter } from './compiler.ts'

export type { RouterContext, MatchedRoute, RouteNode } from './types.ts'
