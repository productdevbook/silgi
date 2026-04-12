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

export { compileRouter }
