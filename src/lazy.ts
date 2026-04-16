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
 *
 * @remarks
 * The module must export its router or procedure as `default`. The
 * returned handle is resolved on demand by {@link resolveLazy} and
 * cached via module-local `WeakMap`s so concurrent resolutions share a
 * single in-flight `Promise`.
 *
 * @param loader - A function returning `import('…')` — typically a
 *   dynamic import expression pointing at a module whose default export
 *   is a `RouterDef` or `ProcedureDef`.
 * @returns A {@link LazyRouter} handle usable as a value inside
 *   `silgi.router({ … })`.
 *
 * @example
 * ```ts
 * const appRouter = k.router({
 *   users: lazy(() => import('./routes/users.ts')),
 *   admin: lazy(() => import('./routes/admin.ts')),
 * })
 * ```
 */
export function lazy(loader: () => Promise<{ default: RouterDef | ProcedureDef }>): LazyRouter {
  return { __lazy: true, load: loader }
}

/**
 * Type guard: `true` when `value` is a {@link LazyRouter} produced by
 * {@link lazy}.
 *
 * @param value - Any value.
 * @returns `true` when `value` carries the `__lazy` brand.
 */
export function isLazy(value: unknown): value is LazyRouter {
  return typeof value === 'object' && value !== null && (value as any).__lazy === true
}

/**
 * Resolve a lazy router and cache the result.
 *
 * @remarks
 * The resolved module is cached in a `WeakMap` keyed on the
 * {@link LazyRouter} handle, so repeat calls return synchronously after
 * the first. Concurrent calls share a single in-flight `Promise` to
 * avoid duplicate imports — the race cache is cleared once the import
 * settles.
 *
 * @param value - A handle returned by {@link lazy}.
 * @returns The default export of the imported module.
 */
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
