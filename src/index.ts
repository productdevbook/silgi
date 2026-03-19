/**
 * Katman — The fastest end-to-end type-safe RPC framework.
 *
 * 5x faster than oRPC. 6x less memory. Single package.
 *
 * @example
 * ```ts
 * import { katman, KatmanError } from "katman"
 * import { z } from "zod"
 *
 * const k = katman({ context: (req) => ({ db: getDB() }) })
 * const { query, mutation, guard, router, handler } = k
 *
 * const auth = guard(async (ctx) => {
 *   const user = await verify(ctx.headers.authorization)
 *   if (!user) throw new KatmanError("UNAUTHORIZED")
 *   return { user }
 * })
 *
 * const listUsers = query(
 *   z.object({ limit: z.number().optional() }),
 *   async ({ input, ctx }) => ctx.db.users.findMany({ take: input.limit }),
 * )
 *
 * const createUser = mutation({
 *   use: [auth],
 *   input: z.object({ name: z.string() }),
 *   errors: { CONFLICT: 409 },
 *   resolve: async ({ input, ctx, fail }) => {
 *     if (await exists(input.email)) fail("CONFLICT")
 *     return ctx.db.users.create(input)
 *   },
 * })
 *
 * export default handler(router({ users: { list: listUsers, create: createUser } }))
 * ```
 */

// ── Main API ────────────────────────────────────────
export { katman } from './katman.ts'
export type { KatmanInstance, KatmanConfig } from './katman.ts'

// ── Builder ─────────────────────────────────────────
export type { ProcedureBuilder, ProcedureBuilderWithOutput } from './builder.ts'

// ── Types ───────────────────────────────────────────
export type {
  ProcedureDef,
  ProcedureType,
  Meta,
  ErrorDef,
  ErrorDefItem,
  FailFn,
  GuardDef,
  WrapDef,
  GuardFn,
  WrapFn,
  MiddlewareDef,
  ResolveContext,
  RouterDef,
  InferClient,
  InferContextFromUse,
  InferGuardOutput,
} from './types.ts'

// ── Error ───────────────────────────────────────────
export { KatmanError, isDefinedError, toKatmanError } from './core/error.ts'
export type { KatmanErrorCode, KatmanErrorOptions, KatmanErrorJSON } from './core/error.ts'

// ── Schema ──────────────────────────────────────────
export { type, validateSchema, ValidationError } from './core/schema.ts'
export type { Schema, AnySchema, InferSchemaInput, InferSchemaOutput } from './core/schema.ts'

// ── SSE/Streaming ───────────────────────────────────
export { withEventMeta, getEventMeta } from './core/sse.ts'
export type { EventMeta } from './core/sse.ts'

// ── Callable ───────────────────────────────────────
export { callable } from './callable.ts'
export type { CallableOptions } from './callable.ts'

// ── Lifecycle ──────────────────────────────────────
export { lifecycleWrap } from './lifecycle.ts'
export type { LifecycleHooks } from './lifecycle.ts'

// ── Input Mapping ──────────────────────────────────
export { mapInput } from './map-input.ts'

// ── Advanced ────────────────────────────────────────
export { compileProcedure, compileRouter, ContextPool } from './compile.ts'
export { AsyncIteratorClass, mapAsyncIterator } from './core/iterator.ts'

// ── Client (re-export for convenience) ──────────────
export { createClient, safe } from './client/client.ts'

// ── Lazy Loading ────────────────────────────────────
export { lazy, isLazy, resolveLazy } from './lazy.ts'
export type { LazyRouter } from './lazy.ts'

// ── OpenAPI / Scalar ────────────────────────────────
export { generateOpenAPI, scalarHTML } from './scalar.ts'
export type { ScalarOptions } from './scalar.ts'
