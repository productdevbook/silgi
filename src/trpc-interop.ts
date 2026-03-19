/**
 * tRPC interop — convert tRPC routers to Katman routers.
 *
 * Enables incremental migration from tRPC to Katman.
 * Wraps each tRPC procedure as a Katman ProcedureDef.
 *
 * @example
 * ```ts
 * import { fromTRPC } from "katman/trpc"
 * import { trpcRouter } from "./trpc-router"
 *
 * const katmanRouter = fromTRPC(trpcRouter)
 *
 * // Now use with Katman's serve(), handler(), etc.
 * k.serve(katmanRouter, { port: 3000 })
 * ```
 */

import type { ProcedureDef, RouterDef } from './types.ts'

/**
 * Convert a tRPC router to a Katman RouterDef.
 *
 * Walks the tRPC router's `_def.procedures` and wraps each one as
 * a Katman ProcedureDef that calls the tRPC procedure's resolver.
 *
 * Supports:
 * - tRPC v10 and v11 routers
 * - Queries, mutations, and subscriptions
 * - Input schemas (passed through as-is)
 * - Middleware (runs inside tRPC, not Katman's pipeline)
 *
 * Does NOT support:
 * - Converting tRPC middleware to Katman guards/wraps
 * - tRPC context factories (use Katman's context instead)
 */
export function fromTRPC(trpcRouter: unknown): RouterDef {
  if (!trpcRouter || typeof trpcRouter !== 'object') {
    throw new Error('fromTRPC: expected a tRPC router object')
  }

  const router = trpcRouter as Record<string, unknown>

  // tRPC v10/v11: router has _def.procedures or is a flat object of procedures
  const procedures = (router as any)._def?.procedures ?? router

  return walkTRPCRouter(procedures)
}

function walkTRPCRouter(node: Record<string, unknown>): RouterDef {
  const result: RouterDef = {}

  for (const [key, value] of Object.entries(node)) {
    if (!value || typeof value !== 'object') continue

    const proc = value as Record<string, unknown>

    // Check if it's a tRPC procedure (has _def with type and resolver)
    if (isTRPCProcedure(proc)) {
      result[key] = convertProcedure(proc)
    } else if (isTRPCRouter(proc)) {
      // Nested router
      const nested = (proc as any)._def?.procedures ?? proc
      result[key] = walkTRPCRouter(nested)
    } else {
      // Try as nested plain object
      result[key] = walkTRPCRouter(proc as Record<string, unknown>)
    }
  }

  return result
}

function isTRPCProcedure(value: Record<string, unknown>): boolean {
  const def = (value as any)._def
  if (!def) return false
  return def.type === 'query' || def.type === 'mutation' || def.type === 'subscription'
}

function isTRPCRouter(value: Record<string, unknown>): boolean {
  return !!(value as any)._def?.procedures
}

function convertProcedure(trpcProc: Record<string, unknown>): ProcedureDef {
  const def = (trpcProc as any)._def
  const type = def.type === 'subscription' ? 'subscription' : def.type === 'mutation' ? 'mutation' : 'query'

  // Extract input schema if available
  const inputParser = def.inputs?.[0] ?? null

  return {
    type,
    input: inputParser,
    output: null,
    errors: null,
    use: null,
    resolve: async ({ input, ctx }: any) => {
      // Call tRPC procedure directly
      // tRPC v10: trpcProc(opts), v11: trpcProc._def.resolver(opts)
      if (typeof def.resolver === 'function') {
        return def.resolver({ input, ctx, type })
      }
      // Fallback: try calling the procedure itself
      if (typeof (trpcProc as any).call === 'function') {
        return (trpcProc as any).call({ input, ctx })
      }
      throw new Error(`Cannot resolve tRPC procedure: ${JSON.stringify(Object.keys(def))}`)
    },
    route: null,
    meta: { __trpc: true },
  }
}
