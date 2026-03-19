/**
 * Lazy loading — deferred procedure/router imports.
 *
 * Enables code splitting: procedures are only loaded
 * when first accessed, reducing cold start time.
 *
 * @example
 * ```ts
 * import { lazy } from "katman"
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
  _resolved?: RouterDef | ProcedureDef
}

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

/** Resolve a lazy router (cached after first load) */
export async function resolveLazy(value: LazyRouter): Promise<RouterDef | ProcedureDef> {
  if (value._resolved) return value._resolved
  const mod = await value.load()
  value._resolved = mod.default
  return mod.default
}
