/**
 * Silgi — End-to-end type-safe RPC framework for TypeScript.
 *
 * Compiled pipelines, single package, every runtime.
 *
 * @example
 * ```ts
 * import { silgi, SilgiError } from "silgi"
 * import { z } from "zod"
 *
 * const k = silgi({ context: (req) => ({ db: getDB() }) })
 *
 * const auth = k.guard(async (ctx) => {
 *   const user = await verify(ctx.headers.authorization)
 *   if (!user) throw new SilgiError("UNAUTHORIZED")
 *   return { user }
 * })
 *
 * const listUsers = k
 *   .$input(z.object({ limit: z.number().optional() }))
 *   .$resolve(async ({ input, ctx }) => ctx.db.users.findMany({ take: input.limit }))
 *
 * const createUser = k
 *   .$use(auth)
 *   .$input(z.object({ name: z.string() }))
 *   .$errors({ CONFLICT: 409 })
 *   .$resolve(async ({ input, ctx, fail }) => {
 *     if (await exists(input.email)) fail("CONFLICT")
 *     return ctx.db.users.create(input)
 *   })
 *
 * export default k.handler(k.router({ users: { list: listUsers, create: createUser } }))
 * ```
 */

// ── Main API ────────────────────────────────────────
export { silgi } from './silgi.ts'
export type { SilgiInstance, SilgiConfig } from './silgi.ts'

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
export { SilgiError, isSilgiError, isDefinedError, toSilgiError } from './core/error.ts'
export type { SilgiErrorCode, SilgiErrorOptions, SilgiErrorJSON } from './core/error.ts'

// ── Schema ──────────────────────────────────────────
export { type, validateSchema, ValidationError, SchemaValidatorCrash } from './core/schema.ts'
export type { Schema, AnySchema, InferSchemaInput, InferSchemaOutput } from './core/schema.ts'

// ── Schema Converters ───────────────────────────────
export { createSchemaRegistry, schemaToJsonSchema } from './core/schema-converter.ts'
export type { SchemaConverter, SchemaRegistry, JSONSchema, ConvertOptions } from './core/schema-converter.ts'

// ── Context Bridge ──────────────────────────────────
export { createContextBridge } from './core/context-bridge.ts'
export type { ContextBridge } from './core/context-bridge.ts'

// ── Context ─────────────────────────────────────────
export type { BaseContext } from './core/context.ts'

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
export { compileProcedure, compileRouter, createContext } from './compile.ts'
export { AsyncIteratorClass, mapAsyncIterator } from './core/iterator.ts'

// ── Router Introspection ────────────────────────────
export { collectProcedures, getProcedurePaths, isProcedureDef } from './core/router-utils.ts'
export type { ProcedureSummary } from './core/router-utils.ts'

// ── Lazy Loading ────────────────────────────────────
export { lazy, isLazy, resolveLazy } from './lazy.ts'
export type { LazyRouter } from './lazy.ts'

// ── Storage ────────────────────────────────────────
export { useStorage, initStorage, resetStorage } from './core/storage.ts'
export type { StorageConfig, Storage, StorageValue, Driver } from './core/storage.ts'

// ── Tasks ──────────────────────────────────────────
export {
  runTask,
  collectCronTasks,
  createCronRegistry,
  startCronJobs,
  stopCronJobs,
  setTaskAnalytics,
  getScheduledTasks,
} from './core/task.ts'
export type { TaskDef, TaskEvent, ScheduledTaskInfo, CronRegistry } from './core/task.ts'

// ── Server ─────────────────────────────────────────
export type { SilgiServer, ServeOptions } from './core/serve.ts'

// ── OpenAPI / Scalar ────────────────────────────────
export { generateOpenAPI, scalarHTML } from './scalar.ts'
export type { ScalarOptions } from './scalar.ts'
