/**
 * Lazy loading — deferred procedure/router imports.
 *
 * Enables code splitting: procedures are only loaded
 * when first accessed, reducing cold start time.
 *
 * @example
 * ```ts
 * import { lazy } from "silgi"
 *
 * const appRouter = k.router({
 *   users: lazy(() => import("./routes/users.ts")),
 *   admin: lazy(() => import("./routes/admin.ts")),
 * })
 * ```
 */

import type { RouterDef, ProcedureDef } from './types.ts'

export interface LazyRouter {
  readonly __lazy: true
  readonly load: () => Promise<{ default: RouterDef | ProcedureDef }>
}

// Resolution cache — keeps LazyRouter interface clean (no mutable properties)
const resolved = new WeakMap<LazyRouter, RouterDef | ProcedureDef>()
const loading = new WeakMap<LazyRouter, Promise<RouterDef | ProcedureDef>>()

/**
 * Wrap a dynamic import for lazy loading.
 * The module must export its router/procedure as `default`.
 */
export function lazy(loader: () => Promise<{ default: RouterDef | ProcedureDef }>): LazyRouter {
  return { __lazy: true, load: loader }
}

/** Check if a value is a lazy router */
export function isLazy(value: unknown): value is LazyRouter {
  return typeof value === 'object' && value !== null && (value as any).__lazy === true
}

/** Resolve a lazy router (cached after first load, race-safe) */
export async function resolveLazy(value: LazyRouter): Promise<RouterDef | ProcedureDef> {
  const cached = resolved.get(value)
  if (cached) return cached

  let pending = loading.get(value)
  if (!pending) {
    pending = value.load().then((mod) => {
      resolved.set(value, mod.default)
      loading.delete(value)
      return mod.default
    })
    loading.set(value, pending)
  }
  return pending
}
