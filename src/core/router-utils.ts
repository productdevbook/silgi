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

// ── Route Resolution for Client ─────────────────────

/** Walk a router tree by path segments and return the procedure's route metadata */
export function resolveRoute(router: unknown, path: readonly string[]): { path: string; method: string } | undefined {
  let current: any = router
  for (const segment of path) {
    if (current == null || typeof current !== 'object') return undefined
    current = current[segment]
  }
  if (!isProcedureDef(current)) return undefined
  const route = current.route as import('../types.ts').Route | undefined
  if (!route?.path) return undefined
  return { path: route.path, method: (route.method ?? 'POST').toUpperCase() }
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
