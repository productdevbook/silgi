import { compileRouter } from '../compile.ts'

import type { CompiledRouterFn } from '../compile.ts'
import type { ProcedureDef, RouterDef } from '../types.ts'

// ── Flat Router Cache ───────────────────────────────

export const routerCache = new WeakMap<RouterDef, CompiledRouterFn>()

export function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'resolve' in value &&
    typeof (value as ProcedureDef).resolve === 'function'
  )
}

// ── Auto Path Assignment ────────────────────────────

export function assignPaths(def: RouterDef, prefix: string[] = []): RouterDef {
  const result: RouterDef = {}
  for (const [key, value] of Object.entries(def)) {
    const currentPath = [...prefix, key]
    if (isProcedureDef(value)) {
      if (!value.route) {
        // Clone procedure — never mutate the user's original def object
        result[key] = { ...value, route: { path: '/' + currentPath.join('/') } }
      } else {
        result[key] = value
      }
    } else if (typeof value === 'object' && value !== null) {
      result[key] = assignPaths(value as RouterDef, currentPath)
    } else {
      result[key] = value
    }
  }
  return result
}

// ── Route Extraction for Client ──────────────────────

/** Extracted route metadata — safe for client bundles (no server code) */
export interface ExtractedRoute {
  path: string
  method: string
}

/** Nested route map — mirrors the router tree structure with only route metadata */
export type ExtractedRoutes = { [key: string]: ExtractedRoute | ExtractedRoutes }

/**
 * Extract route metadata from a router definition.
 * Returns a lightweight nested object safe for client bundles — no resolve functions,
 * no guards, no schemas, no server code.
 *
 * ```ts
 * // server/routes.ts — import this on the client
 * export const routes = extractRoutes(appRouter)
 * ```
 */
export function extractRoutes(def: unknown, prefix: string[] = []): ExtractedRoutes {
  const result: ExtractedRoutes = {}
  if (def == null || typeof def !== 'object') return result
  for (const [key, value] of Object.entries(def)) {
    const route = getRouteFromEntry(value)
    if (route?.path) {
      result[key] = { path: route.path, method: (route.method ?? 'POST').toUpperCase() }
    } else if (typeof value === 'object' && value !== null && !isProcedureDef(value)) {
      const nested = extractRoutes(value, [...prefix, key])
      if (Object.keys(nested).length > 0) result[key] = nested
    }
  }
  return result
}

/** Extract route metadata from a ProcedureDef or ProcedureContract */
function getRouteFromEntry(value: unknown): import('../types.ts').Route | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const obj = value as Record<string, unknown>
  // ProcedureDef: { type, resolve, route }
  if (isProcedureDef(value)) {
    return obj.route as import('../types.ts').Route | undefined
  }
  // ProcedureContract: { route, input?, output? } — no resolve function
  if ('route' in obj && typeof obj.route === 'object' && obj.route !== null) {
    return obj.route as import('../types.ts').Route
  }
  return undefined
}

/** Check if a value is an extracted route leaf (has path + method, not a nested object) */
function isExtractedRoute(value: unknown): value is ExtractedRoute {
  return typeof value === 'object' && value !== null && 'path' in value && 'method' in value && !('resolve' in value)
}

// ── Route Resolution for Client ─────────────────────

/** Walk a route tree by path segments and return the route metadata. Works with both full routers and extracted routes. */
export function resolveRoute(routes: unknown, path: readonly string[]): { path: string; method: string } | undefined {
  let current: any = routes
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[segment]
  }
  // Extracted route: { path, method }
  if (isExtractedRoute(current)) return current
  // Full procedure or contract: extract route metadata
  const route = getRouteFromEntry(current)
  if (route?.path) {
    return { path: route.path, method: (route.method ?? 'POST').toUpperCase() }
  }
  return undefined
}

/**
 * Substitute :param placeholders in a route path with values from input.
 * Returns the resolved URL path and the input with used params removed.
 */
export function substituteParams(routePath: string, input: unknown): { url: string; remainingInput: unknown } {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { url: routePath, remainingInput: input }
  }
  const obj = input as Record<string, unknown>
  const used = new Set<string>()
  const url = routePath.replace(/:([a-zA-Z_]\w*)/g, (_match, name: string) => {
    const val = obj[name]
    if (val !== undefined) {
      used.add(name)
      return encodeURIComponent(String(val))
    }
    return `:${name}`
  })
  if (used.size === 0) return { url, remainingInput: input }
  const remaining: Record<string, unknown> = {}
  for (const key of Object.keys(obj)) {
    if (!used.has(key)) remaining[key] = obj[key]
  }
  return { url, remainingInput: Object.keys(remaining).length > 0 ? remaining : undefined }
}

export { compileRouter }
