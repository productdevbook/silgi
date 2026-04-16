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

// ── Router Introspection ────────────────────────────

/**
 * Walk a router tree and invoke `cb` for every procedure.
 *
 * @remarks
 * Depth-first traversal. `path` is the segment list from the router
 * root to the procedure (e.g. `['users', 'list']`). Use this when you
 * need the live `ProcedureDef` reference (e.g. to read `.input`,
 * `.output`, `.route`, `.meta`). For a flat list of paths only, use
 * {@link getProcedurePaths}.
 */
export function collectProcedures(router: RouterDef, cb: (path: string[], proc: ProcedureDef) => void): void {
  walk(router, [], cb)
}

function walk(node: unknown, path: string[], cb: (path: string[], proc: ProcedureDef) => void): void {
  if (isProcedureDef(node)) {
    cb(path, node)
    return
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      walk(child, [...path, key], cb)
    }
  }
}

/**
 * Flat list of every procedure in a router tree.
 *
 * @remarks
 * Each entry carries the dot-joined path (e.g. `'users.list'`), the
 * effective HTTP path (from `$route({ path })` or auto-derived), the
 * method, the procedure kind and a direct reference to the
 * `ProcedureDef`. Useful for generating client stubs, auditing the
 * surface, or writing custom dashboards.
 */
export interface ProcedureSummary {
  /** Dot-joined segment path, e.g. `'users.list'`. */
  name: string
  /** Router tree segments, e.g. `['users', 'list']`. */
  segments: string[]
  /** HTTP path used by the handler (auto or `$route`-overridden). */
  httpPath: string
  /** HTTP method (uppercase), or `'*'` when wildcarded. */
  method: string
  /** Procedure kind — `'query'`, `'mutation'`, `'subscription'`. */
  type: ProcedureDef['type']
  /** Live `ProcedureDef` reference. */
  procedure: ProcedureDef
}

export function getProcedurePaths(router: RouterDef): ProcedureSummary[] {
  const out: ProcedureSummary[] = []
  walk(router, [], (segments, proc) => {
    const route = proc.route as import('../types.ts').Route | null
    const httpPath = route?.path ?? '/' + segments.join('/')
    const method = route?.method?.toUpperCase() ?? 'POST'
    out.push({
      name: segments.join('.'),
      segments,
      httpPath,
      method,
      type: proc.type,
      procedure: proc,
    })
  })
  return out
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
