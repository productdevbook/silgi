/**
 * silgi() — the main entry point.
 *
 * Creates a Silgi instance with typed context.
 * All procedure/middleware factories are methods on this instance,
 * so context type flows automatically.
 *
 * Usage:
 *   const k = silgi({ context: (req) => ({ db, headers }) })
 *   // k.$input(), k.$resolve(), k.$use(), k.guard(), k.router(), k.handler()
 */

import { createHooks } from 'hookable'

import { createProcedureBuilder } from './builder.ts'
import { createCaller } from './caller.ts'
import { compileRouter } from './compile.ts'
import { createFetchHandler, wrapHandler } from './core/handler.ts'
import { assignPaths, routerCache } from './core/router-utils.ts'
import { createSchemaRegistry } from './core/schema-converter.ts'
import { createTaskFromProcedure } from './core/task.ts'
import { normalizePrefix } from './core/url.ts'

import type { ProcedureBuilder } from './builder.ts'
import type { FetchHandler } from './core/handler.ts'
import type { SchemaConverter, SchemaRegistry } from './core/schema-converter.ts'
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './core/schema.ts'
import type { ServeOptions, SilgiServer } from './core/serve.ts'
import type { StorageConfig } from './core/storage.ts'
import type { useStorage } from './core/storage.ts'
import type { AnalyticsOptions } from './plugins/analytics.ts'
import type { ScalarOptions } from './scalar.ts'
import type {
  ProcedureDef,
  ProcedureType,
  ErrorDef,
  GuardDef,
  WrapDef,
  GuardFn,
  WrapFn,
  ResolveContext,
  RouterDef,
  InferClient,
} from './types.ts'
import type { Hookable } from 'hookable'

// ── Lifecycle Hooks ─────────────────────────────────

export interface SilgiHooks {
  /** Called before a request is processed */
  request: (event: { path: string; input: unknown }) => void
  /** Called after a successful response */
  response: (event: { path: string; output: unknown; durationMs: number }) => void
  /** Called when an error occurs */
  error: (event: { path: string; error: unknown }) => void
  /** Called when the server starts */
  'serve:start': (event: { url: string; port: number; hostname: string }) => void
  /** Called when the server is shutting down */
  'serve:stop': (event: { url: string; port: number; hostname: string }) => void
  /**
   * Fires after base context is applied and params are merged, before input parsing.
   * Framework plugins (e.g. analytics) use this to inject fields into `ctx`
   * before any user code runs.
   *
   * @internal
   */
  'request:prepare': (event: { request: Request; ctx: Record<string, unknown> }) => void
  /**
   * Fires after the pipeline produces output, before the `Response` is built.
   * Framework plugins use this to capture output for trace recording.
   *
   * @internal
   */
  'response:finalize': (event: { request: Request; ctx: Record<string, unknown>; output: unknown }) => void
}

// ── Silgi Instance ─────────────────────────────────

export interface SilgiConfig<TCtx extends Record<string, unknown>> {
  context: (req: Request) => TCtx | Promise<TCtx>
  /** Register lifecycle hooks */
  hooks?: Partial<{ [K in keyof SilgiHooks]: SilgiHooks[K] | SilgiHooks[K][] }>
  /**
   * Schema converters for OpenAPI spec generation and analytics schema extraction.
   *
   * @remarks
   * Pass a converter for each schema library you use. Schemas with a native
   * `jsonSchema.input()` implementation (Valibot, ArkType, Zod v4) work
   * without registering anything. Converters are required for libraries
   * that do not implement the Standard JSON Schema extension.
   *
   * @example
   * ```ts
   * import { zodConverter } from 'silgi/zod'
   *
   * const k = silgi({
   *   context: (req) => ({ db: getDB() }),
   *   schemaConverters: [zodConverter],
   * })
   * ```
   */
  schemaConverters?: SchemaConverter[]
  /**
   * Storage configuration — mount drivers by path prefix.
   *
   * ```ts
   * import redisDriver from 'unstorage/drivers/redis'
   * import memoryDriver from 'unstorage/drivers/memory'
   *
   * storage: {
   *   cache: redisDriver({ url: 'redis://localhost' }),
   *   sessions: memoryDriver(),
   * }
   * ```
   *
   * Or pass a pre-built unstorage instance:
   * ```ts
   * storage: myStorageInstance
   * ```
   */
  storage?: StorageConfig
}

export interface SilgiInstance<TBaseCtx extends Record<string, unknown>> {
  /** Register a lifecycle hook */
  hook: Hookable<SilgiHooks>['hook']

  /** Remove a lifecycle hook */
  removeHook: Hookable<SilgiHooks>['removeHook']
  /** Access storage with optional prefix — uses configured mounts */
  useStorage: typeof useStorage

  /** Create a guard middleware (flat, zero-closure) */
  guard: GuardFactory<TBaseCtx>

  /** Create a wrap middleware (onion, before+after) */
  wrap: (fn: WrapFn<TBaseCtx>) => WrapDef<TBaseCtx>

  /** Start a builder — resolve only */
  $resolve: ProcedureBuilder<'query', TBaseCtx>['$resolve']

  /** Start a builder — set input schema */
  $input: ProcedureBuilder<'query', TBaseCtx>['$input']

  /** Start a builder — add middleware */
  $use: ProcedureBuilder<'query', TBaseCtx>['$use']

  /** Start a builder — set output schema */
  $output: ProcedureBuilder<'query', TBaseCtx>['$output']

  /** Start a builder — set errors */
  $errors: ProcedureBuilder<'query', TBaseCtx>['$errors']

  /** Start a builder — set route metadata */
  $route: ProcedureBuilder<'query', TBaseCtx>['$route']

  /** Start a builder — set custom metadata */
  $meta: ProcedureBuilder<'query', TBaseCtx>['$meta']

  /** Define a subscription (SSE stream) */
  subscription: SubscriptionFactory<TBaseCtx>

  /** Start a builder — create a background task */
  $task: ProcedureBuilder<'query', TBaseCtx>['$task']

  /** Assemble router and compile pipelines */
  router: <T extends RouterDef>(def: T) => T

  /** Create a Fetch API handler: (Request) => Response */
  handler: (
    router: RouterDef,
    options?: {
      /** URL path prefix (e.g. "/api"). Only requests matching this prefix are handled; others return 404. */
      basePath?: string
      /** Enable Scalar API Reference UI at /api/reference and /api/openapi.json */
      scalar?: boolean | ScalarOptions
      /** Enable analytics dashboard at /api/analytics — requires `auth` to be set */
      analytics?: AnalyticsOptions
    },
  ) => (request: Request) => Response | Promise<Response>

  /** Create a direct caller — call procedures without HTTP. For testing and server-side usage. */
  createCaller: <T extends RouterDef>(
    router: T,
    options?: {
      /** Override or extend the base context */
      contextOverride?: Record<string, unknown>
      /** Mock request headers */
      headers?: Record<string, string>
      /** Default timeout in ms (default: 30000, null = no timeout) */
      timeout?: number | null
    },
  ) => InferClient<T>

  /** Create & start a Node.js HTTP server. Returns a handle to gracefully shut down. */
  serve: (router: RouterDef, options?: ServeOptions) => Promise<SilgiServer>
}

// ── Guard Factory ───────────────────────────────────

interface GuardConfig<TBaseCtx, TReturn extends Record<string, unknown> | void, TErrors extends ErrorDef> {
  errors?: TErrors
  fn: GuardFn<TBaseCtx, TReturn>
}

interface GuardFactory<TBaseCtx> {
  /** Simple guard: guard(fn) */
  <TReturn extends Record<string, unknown> | void>(fn: GuardFn<TBaseCtx, TReturn>): GuardDef<TBaseCtx, TReturn, {}>

  /** Guard with typed errors: guard({ errors, fn }) */
  <TReturn extends Record<string, unknown> | void, TErrors extends ErrorDef>(
    config: GuardConfig<TBaseCtx, TReturn, TErrors>,
  ): GuardDef<TBaseCtx, TReturn, TErrors>
}

// ── Procedure Factories ──────────────────────────────

interface SubscriptionFactory<TBaseCtx extends Record<string, unknown>> {
  /** Builder: `subscription()` — returns chainable builder */
  (): ProcedureBuilder<'subscription', TBaseCtx>
  /** Short: `subscription(resolve)` */
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => AsyncIterableIterator<TOutput>,
  ): ProcedureDef<'subscription', undefined, TOutput, {}>
  /** Short: `subscription(input, resolve)` */
  <TSchema extends AnySchema, TOutput>(
    input: TSchema,
    resolve: (opts: ResolveContext<TBaseCtx, InferSchemaOutput<TSchema>, {}>) => AsyncIterableIterator<TOutput>,
  ): ProcedureDef<'subscription', InferSchemaInput<TSchema>, TOutput, {}>
}

// ── Implementation ──────────────────────────────────

function createProcedure(type: ProcedureType, ...args: unknown[]): ProcedureDef | ProcedureBuilder<any, any> {
  // Builder form: no arguments → return chainable builder
  if (args.length === 0) {
    return createProcedureBuilder(type)
  }

  // Short form: (resolve)
  if (args.length === 1 && typeof args[0] === 'function') {
    return {
      type,
      input: null,
      output: null,
      errors: null,
      use: null,
      resolve: args[0] as Function,
      route: null,
      meta: null,
    }
  }

  // Short form: (input, resolve)
  if (args.length === 2 && typeof args[1] === 'function') {
    return {
      type,
      input: args[0] as AnySchema,
      output: null,
      errors: null,
      use: null,
      resolve: args[1] as Function,
      route: null,
      meta: null,
    }
  }

  throw new TypeError(`Invalid arguments for ${type}()`)
}

/**
 * Create a Silgi RPC instance with typed context.
 *
 * @example
 * ```ts
 * const k = silgi({
 *   context: (req) => ({ db: getDB(), user: getUser(req) }),
 *   hooks: {
 *     request: ({ path }) => console.log(`-> ${path}`),
 *   },
 * })
 * // k.$input(), k.$resolve(), k.guard(), k.router(), k.serve()
 * ```
 */
export function silgi<TBaseCtx extends Record<string, unknown>>(
  config: SilgiConfig<TBaseCtx>,
): SilgiInstance<TBaseCtx> {
  const contextFactory = config.context

  // Per-instance schema registry — no global mutable state
  const schemaRegistry: SchemaRegistry = createSchemaRegistry(config.schemaConverters ?? [])

  // Hooks — synchronous init (hookable is tiny ~2KB, must be sync for API compat)
  const hooks = createHooks<SilgiHooks>()
  if (config.hooks) {
    for (const [name, fn] of Object.entries(config.hooks)) {
      if (Array.isArray(fn)) {
        for (const f of fn) hooks.hook(name as keyof SilgiHooks, f as any)
      } else if (fn) {
        hooks.hook(name as keyof SilgiHooks, fn as any)
      }
    }
  }

  // Initialize storage lazily (only if configured)
  if (config.storage) {
    import('./core/storage.ts')
      .then((m) => m.initStorage(config.storage))
      .catch((e) => {
        console.error(`[silgi] Failed to initialize storage: ${e instanceof Error ? e.message : e}`)
      })
  }

  const ctxFactory = () => contextFactory(new Request('http://localhost'))

  const instance: SilgiInstance<TBaseCtx> = {
    hook: hooks.hook.bind(hooks),
    removeHook: hooks.removeHook.bind(hooks),
    useStorage: (...args: Parameters<typeof import('./core/storage.ts').useStorage>) => {
      return import('./core/storage.ts').then((m) => m.useStorage(...args)) as any
    },

    guard: (fnOrConfig: any) => {
      if (typeof fnOrConfig === 'function') {
        return { kind: 'guard' as const, fn: fnOrConfig }
      }
      return { kind: 'guard' as const, fn: fnOrConfig.fn, errors: fnOrConfig.errors }
    },
    wrap: (fn) => ({ kind: 'wrap' as const, fn }),

    $resolve: ((fn: any) => createProcedure('query', fn)) as any,
    $input: ((schema: any) => createProcedureBuilder('query', ctxFactory).$input(schema)) as any,
    $use: ((...middleware: any[]) => {
      const b = createProcedureBuilder('query', ctxFactory) as any
      for (const m of middleware) b.$use(m)
      return b
    }) as any,
    $output: ((schema: any) => createProcedureBuilder('query', ctxFactory).$output(schema)) as any,
    $errors: ((errors: any) => createProcedureBuilder('query', ctxFactory).$errors(errors)) as any,
    $route: ((route: any) => createProcedureBuilder('query', ctxFactory).$route(route)) as any,
    $meta: ((meta: any) => createProcedureBuilder('query', ctxFactory).$meta(meta)) as any,

    subscription: ((...args: unknown[]) => createProcedure('subscription', ...args)) as SubscriptionFactory<TBaseCtx>,

    $task: ((config: any) => {
      return createTaskFromProcedure(config, config.resolve, null, null, ctxFactory)
    }) as any,

    router: (def) => {
      const assigned = assignPaths(def)
      const flat = compileRouter(assigned)
      // Cache against the original def — don't mutate user's object
      routerCache.set(def, flat)
      routerCache.set(assigned, flat)
      return def
    },

    createCaller: (routerDef, options) => {
      return createCaller(routerDef, contextFactory, options)
    },

    handler: (routerDef, options) => {
      const prefix = options?.basePath ? normalizePrefix(options.basePath) : undefined
      const fetchHandler = wrapHandler(
        createFetchHandler(routerDef, contextFactory, hooks, prefix),
        routerDef,
        options ? { ...options, schemaRegistry, hooks } : { schemaRegistry, hooks },
        prefix,
      )

      // Check if router has any subscriptions → auto-attach crossws hooks for Nitro/srvx
      const hasWsProcedures = (function checkWs(def: any): boolean {
        if (!def || typeof def !== 'object') return false
        if (def.type === 'subscription') return true
        for (const v of Object.values(def)) {
          if (checkWs(v)) return true
        }
        return false
      })(routerDef)

      if (!hasWsProcedures) return fetchHandler

      // Lazy-load WS hooks
      let wsHooks: Record<string, Function> | undefined
      let wsInitPromise: Promise<void> | undefined

      async function initWsHooks(): Promise<void> {
        const { _createWSHooks } = await import('./ws.ts')
        wsHooks = _createWSHooks(routerDef, {
          context: (peer) => {
            const req: Request = (peer?.request instanceof Request ? peer.request : peer) as Request
            return contextFactory(req)
          },
        }) as Record<string, Function>
      }

      const wsPath = prefix ? `${prefix}/_ws` : '/_ws'

      return async (request: Request): Promise<Response> => {
        // Intercept /_ws path — return empty response with .crossws hooks for Nitro/h3
        const url = new URL(request.url)
        if (url.pathname === wsPath) {
          if (!wsHooks) {
            wsInitPromise ??= initWsHooks()
            await wsInitPromise
          }
          const response = new Response(null, { status: 200 })
          ;(response as any).crossws = wsHooks
          return response
        }

        return fetchHandler(request)
      }
    },

    serve: async (routerDef, options) => {
      const { createServeHandler } = await import('./core/serve.ts')
      const server = await createServeHandler(routerDef, contextFactory, hooks, options, schemaRegistry)

      // Auto-discover and start cron tasks from router
      const { collectCronTasks, startCronJobs, stopCronJobs } = await import('./core/task.ts')
      const cronTasks = collectCronTasks(routerDef)
      if (cronTasks.length > 0) {
        await startCronJobs(cronTasks)
        console.log(`  ${cronTasks.length} cron task(s) scheduled`)
      }

      // Stop cron jobs on server close and process signals
      const originalClose = server.close.bind(server)
      server.close = async (force?: boolean) => {
        stopCronJobs()
        return originalClose(force)
      }
      const onSignal = () => stopCronJobs()
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)

      return server
    },
  }

  return instance
}
