/**
 * Route metadata utilities for client-server communication.
 *
 * `minifyContractRouter()` extracts `{ path, method }` from a router — safe to
 * serialize as JSON and ship to client bundles. Zero server code leakage.
 *
 * @example
 * ```ts
 * // Build-time script
 * import { minifyContractRouter } from 'silgi/contract'
 * import { appRouter } from './server/router'
 * fs.writeFileSync('routes.json', JSON.stringify(minifyContractRouter(appRouter)))
 *
 * // Client
 * import routes from './routes.json'
 * const link = createLink({ url: '...', routes })
 * ```
 */

import type { Route } from './types.ts'

// ── Minify Contract Router ─────────────────────────

/**
 * Strip all business logic from a router, keeping only `{ path, method }` per procedure.
 * Safe to serialize as JSON and ship to client bundles.
 *
 * Works with routers created via `s.router()`.
 */
export function minifyContractRouter(def: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  if (def == null || typeof def !== 'object') return result

  for (const [key, value] of Object.entries(def)) {
    if (typeof value !== 'object' || value === null) continue
    const obj = value as Record<string, unknown>

    // ProcedureDef: has resolve + route
    const route = obj.route as Route | undefined
    if (route?.path) {
      result[key] = {
        path: route.path,
        method: (route.method ?? 'POST').toUpperCase(),
      }
    } else if ('resolve' in obj || 'type' in obj) {
      // Procedure without custom route — skip
    } else {
      // Nested router
      const nested = minifyContractRouter(value)
      if (Object.keys(nested).length > 0) result[key] = nested
    }
  }

  return result
}
