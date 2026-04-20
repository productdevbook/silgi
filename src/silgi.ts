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
import { createContextBridge } from './core/context-bridge.ts'
import { ROOT_WRAPS } from './core/ctx-symbols.ts'
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
  MiddlewareDef,
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
   * Root-level wrap middleware applied to every procedure in the router.
   *
   * @remarks
   * Each entry must be created via `instance.wrap(fn)`. Root wraps run
   * as the outermost layer of the onion: root wraps → route-level
   * `.$use()` guards/wraps → resolver. Use this for concerns that must
   * apply to every route (tenant scoping, `AsyncLocalStorage` setup,
   * trace propagation), where missing one route would be a bug.
   *
   * Root wraps cannot mutate the context type — use a route-level
   * `$use(guard)` for that. The ambient context passed to `next()` is
   * `TBaseCtx`, identical to the one seen by route-level wraps.
   *
   * Applies to every procedure reachable through `handler()`,
   * `createCaller()`, and HTTP/cron task invocation. Task `dispatch()`
   * (programmatic, bypasses the pipeline) is not wrapped.
   *
   * @example
   * ```ts
   * const tenantScopeWrap: WrapDef = {
   *   kind: 'wrap',
   *   fn: (ctx, next) => tenantScope.run({ orgId: ctx.user.orgId }, next),
   * }
   *
   * const s = silgi({
   *   context: (req) => ({ db, user: readUser(req) }),
   *   wraps: [tenantScopeWrap],
   * })
   * ```
   *
   * For convenience you can also create wraps with the standalone
   * helper or from another silgi instance's `wrap()` method.
   */
  wraps?: WrapDef<TCtx>[]
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

  /**
   * Run `fn` inside this instance's per-request `AsyncLocalStorage` scope.
   *
   * @remarks
   * Instrumented integrations (Drizzle, Better Auth) read the installed
   * context via {@link SilgiInstance.currentContext}. Because each silgi
   * instance owns its own bridge, calls across instances do not collide.
   *
   * @param ctx - Context to install for the duration of `fn`.
   * @param fn - Function executed with `ctx` as the ambient context.
   * @returns Whatever `fn` returns.
   */
  runInContext: <T>(ctx: TBaseCtx, fn: () => T) => T

  /**
   * Read the context installed by the nearest enclosing
   * {@link SilgiInstance.runInContext}, or `undefined` if none.
   */
  currentContext: () => TBaseCtx | undefined

  /**
   * Await storage initialization.
   *
   * @remarks
   * When `storage` is configured, resolves after `initStorage` completes.
   * When storage is not configured, resolves immediately (no dynamic
   * import). Errors during storage init reject this promise — no silent
   * `console.error` fallback.
   *
   * `useStorage()` awaits this promise internally, so calling `ready()`
   * is optional unless you need an explicit ordering guarantee before
   * your first `useStorage()` call.
   *
   * @example
   * ```ts
   * const k = silgi({ context: () => ({}), storage: { cache: redisDriver() } })
   * await k.ready() // storage driver connected
   * ```
   */
  ready: () => Promise<void>

  /**
   * Create a guard middleware — a flat, zero-closure helper that runs
   * before the resolver and can throw or return partial context.
   *
   * @remarks
   * Prefer `guard` over `wrap` when you only need a pre-step. The
   * returned object is passed to `$use(guard)` on any builder.
   */
  guard: GuardFactory<TBaseCtx>

  /**
   * Create a wrap middleware — onion-style before/after hook that can
   * short-circuit the pipeline or transform the output.
   */
  wrap: (fn: WrapFn<TBaseCtx>) => WrapDef<TBaseCtx>

  /** Start a builder chain — set the resolver for a query procedure. */
  $resolve: ProcedureBuilder<'query', TBaseCtx>['$resolve']

  /** Start a builder chain — set the input schema (Standard Schema). */
  $input: ProcedureBuilder<'query', TBaseCtx>['$input']

  /** Start a builder chain — add guard/wrap middleware. */
  $use: ProcedureBuilder<'query', TBaseCtx>['$use']

  /** Start a builder chain — set the output schema. */
  $output: ProcedureBuilder<'query', TBaseCtx>['$output']

  /** Start a builder chain — declare typed errors. */
  $errors: ProcedureBuilder<'query', TBaseCtx>['$errors']

  /** Start a builder chain — set HTTP route metadata (method, path, etc). */
  $route: ProcedureBuilder<'query', TBaseCtx>['$route']

  /** Start a builder chain — attach custom metadata for tooling. */
  $meta: ProcedureBuilder<'query', TBaseCtx>['$meta']

  /** Define a subscription — returns an SSE stream of events. */
  subscription: SubscriptionFactory<TBaseCtx>

  /**
   * Start a builder chain — create a background/cron task.
   *
   * @remarks
   * Tasks are collected from the router on `serve()` and scheduled via
   * `croner` when a `cron` spec is provided.
   */
  $task: ProcedureBuilder<'query', TBaseCtx>['$task']

  /**
   * Assemble a router from nested procedures and pre-compile each
   * pipeline.
   *
   * @remarks
   * The returned value is the same object you passed in — path
   * assignment and compilation happen off to the side, cached in a
   * `WeakMap` keyed on the def. Never mutate the router after handing
   * it to `router()`; build a new one instead.
   */
  router: <T extends RouterDef>(def: T) => T

  /**
   * Create a Fetch API handler — `(Request) => Response | Promise<Response>`.
   *
   * @remarks
   * Use this from any Fetch-compatible adapter (Next.js App Router,
   * SvelteKit, Remix, srvx, Cloudflare Workers, Bun, Deno, hono over
   * Lambda, etc.). The router has subscriptions mounted automatically
   * when `hasWsProcedures` is detected.
   */
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

  /**
   * Create & start a Node.js HTTP server. Returns a handle to gracefully shut down.
   *
   * @remarks
   * When `options.handleSignals` is `true`, registers `process.once('SIGINT')`
   * and `process.once('SIGTERM')` listeners that invoke `server.close()`.
   * Default `false` — opt in explicitly. The srvx-level graceful HTTP drain
   * is controlled by `ServeOptions.gracefulShutdown`; `handleSignals`
   * governs only the silgi-layer cron-stop wiring on OS signals.
   */
  serve: (
    router: RouterDef,
    options?: ServeOptions & {
      /**
       * Register `process.once('SIGINT')` / `'SIGTERM'` listeners that call
       * `server.close()`. Default `false` (opt-in). The close wrapper stops
       * cron jobs regardless of this setting when called explicitly.
       */
      handleSignals?: boolean
    },
  ) => Promise<SilgiServer>
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

// ─── Implementation ───────────────────────────────────────────────────

/**
 * Build a `ProcedureDef` with all optional slots set to `null`.
 *
 * Procedures carry eight slots — `type`, `input`, `output`, `errors`,
 * `use`, `resolve`, `route`, `meta`. Most call sites set only a couple;
 * funnelling construction through this helper keeps the shape in one
 * place so new slots do not have to be added to every short form.
 */
function makeProcedureDef(
  type: ProcedureType,
  input: AnySchema | null,
  resolve: Function,
): ProcedureDef {
  return {
    type,
    input,
    output: null,
    errors: null,
    use: null,
    resolve,
    route: null,
    meta: null,
  }
}

/**
 * Dispatch on the call shape of `$resolve` / `subscription`.
 *
 *   createProcedure(type)                 → chainable builder
 *   createProcedure(type, resolve)        → single-shot procedure
 *   createProcedure(type, input, resolve) → single-shot with input schema
 */
function createProcedure(type: ProcedureType, ...args: unknown[]): ProcedureDef | ProcedureBuilder<any, any> {
  if (args.length === 0) {
    return createProcedureBuilder(type)
  }
  if (args.length === 1 && typeof args[0] === 'function') {
    return makeProcedureDef(type, null, args[0] as Function)
  }
  if (args.length === 2 && typeof args[1] === 'function') {
    return makeProcedureDef(type, args[0] as AnySchema, args[1] as Function)
  }
  throw new TypeError(`Invalid arguments for ${type}()`)
}

/**
 * Stamp root wraps onto a router def via a non-enumerable Symbol-keyed
 * property. Idempotent for the same wrap reference; throws when a
 * different silgi instance has already registered the def, because a
 * single compiled router cannot serve two different context shapes.
 *
 * @internal
 */
function stampRootWraps(def: object, wraps: readonly WrapDef[]): void {
  const existing = (def as { [ROOT_WRAPS]?: readonly WrapDef[] })[ROOT_WRAPS]
  if (existing === wraps) return
  if (existing) {
    throw new TypeError(
      'silgi: this router def is already registered with a different silgi instance — build a fresh router object.',
    )
  }
  Object.defineProperty(def, ROOT_WRAPS, {
    value: wraps,
    enumerable: false,
    writable: false,
    configurable: false,
  })
}

/**
 * Validate + freeze the `wraps` config array.
 *
 * Guards are rejected at the instance level because a guard's return
 * type must flow into every procedure's context, and the instance-level
 * config cannot express that across an unknown router shape. Guards
 * must be attached via route-level `.$use()` where the context
 * enrichment can be typed.
 */
function prepareRootWraps(wraps: WrapDef<any>[] | undefined): readonly WrapDef[] | null {
  if (!wraps || wraps.length === 0) return null
  for (const w of wraps) {
    if (!w || (w as MiddlewareDef).kind !== 'wrap') {
      throw new TypeError('silgi({ wraps }) only accepts wrap middleware — use route-level .$use() for guards.')
    }
  }
  return Object.freeze([...wraps]) as readonly WrapDef[]
}

/**
 * Register the user-provided hook listeners on a fresh `Hookable`.
 * Accepts either a single function or an array of functions per hook,
 * matching the shape documented on `SilgiConfig['hooks']`.
 */
function registerHooks(
  hooks: Hookable<SilgiHooks>,
  config: SilgiConfig<any>['hooks'],
): void {
  if (!config) return
  for (const [name, fn] of Object.entries(config)) {
    const key = name as keyof SilgiHooks
    if (Array.isArray(fn)) {
      for (const f of fn) hooks.hook(key, f as any)
    } else if (fn) {
      hooks.hook(key, fn as any)
    }
  }
}

/**
 * Build the storage-ready promise. Resolves immediately when no storage
 * is configured — and crucially, never triggers the dynamic import in
 * that case, so tree-shakers can drop the driver code entirely.
 */
function makeStorageReady(storage: StorageConfig | undefined): Promise<void> {
  if (!storage) return Promise.resolve()
  return import('./core/storage.ts').then((m) => {
    m.initStorage(storage)
  })
}

/**
 * Recursively search a router def for any `subscription` procedure.
 * Used to decide whether `handler()` should bother to lazy-load the
 * crossws hooks for the `/_ws` mount.
 */
function routerHasSubscriptions(def: unknown): boolean {
  if (!def || typeof def !== 'object') return false
  if ((def as { type?: string }).type === 'subscription') return true
  for (const child of Object.values(def as Record<string, unknown>)) {
    if (routerHasSubscriptions(child)) return true
  }
  return false
}

/**
 * Create a Silgi RPC instance with typed context.
 *
 * @remarks
 * Every call returns a self-contained instance with its own schema
 * registry, `AsyncLocalStorage` bridge, hook emitter and storage state.
 * Two `silgi()` instances in the same process never share mutable state
 * — see [ARCHITECTURE.md §3](../ARCHITECTURE.md) for the "de-magic"
 * invariants.
 *
 * @typeParam TBaseCtx - Shape of the base context returned by
 *   `config.context(req)`. Flows into every procedure's `ResolveContext`.
 * @param config - Instance configuration. `context` is required; all
 *   other fields are opt-in.
 * @returns A {@link SilgiInstance} exposing builder, router, handler,
 *   caller and server helpers.
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
 *
 * @see {@link SilgiInstance}
 * @see {@link SilgiConfig}
 */
export function silgi<TBaseCtx extends Record<string, unknown>>(
  config: SilgiConfig<TBaseCtx>,
): SilgiInstance<TBaseCtx> {
  const contextFactory = config.context

  // Everything in this block is per-instance — the framework holds no
  // global mutable state. Two `silgi()` instances in the same process
  // never observe each other's hooks, schemas, bridges, or storage.
  const schemaRegistry: SchemaRegistry = createSchemaRegistry(config.schemaConverters ?? [])
  const bridge = createContextBridge<TBaseCtx>()
  const hooks = createHooks<SilgiHooks>()
  registerHooks(hooks, config.hooks)
  const readyPromise = makeStorageReady(config.storage)
  const rootWraps = prepareRootWraps(config.wraps)

  // Builders and tasks need a zero-argument context factory — the real
  // factory takes a `Request`, so here we supply a synthetic one that
  // carries no headers. Callers that genuinely need request data must
  // use the HTTP path; `createCaller` / `$task` give you the direct
  // pipeline but not a live `Request`.
  const ctxFactory = () => contextFactory(new Request('http://localhost'))

  // Tasks receive a *getter* so that a later `router()` call can still
  // see the wraps array even if tasks were constructed first. When no
  // wraps are configured we pass `null`; `createTaskFromProcedure`
  // walks a straight path in that case.
  const rootWrapsGetter: (() => readonly WrapDef[] | null) | null = rootWraps ? () => rootWraps : null

  // ─── Builder factories ───────────────────────────────────────────
  //
  // Each `$x()` method starts a chainable builder preconfigured with
  // this instance's context factory and root wraps. We build a small
  // helper for the common case.

  const startBuilder = () => createProcedureBuilder('query', ctxFactory, rootWrapsGetter)

  // ─── Router registration ─────────────────────────────────────────

  const registerRouter = <T extends RouterDef>(def: T): T => {
    const assigned = assignPaths(def)
    // Stamping the wraps on both `def` and `assigned` means every
    // downstream compile site — `handler()`, `createCaller()`, auto-WS,
    // external adapters (Express, Lambda, NestJS, message-port, broker,
    // batch-server) — picks them up through `compileRouter` reading
    // `def[ROOT_WRAPS]`. The brand is a non-enumerable Symbol so the
    // router walker in `compileRouter` never sees it. When `rootWraps`
    // is null we skip the stamp entirely and `def` stays byte-identical
    // to its pre-call shape.
    if (rootWraps) {
      stampRootWraps(def, rootWraps)
      stampRootWraps(assigned, rootWraps)
    }
    const compiled = compileRouter(assigned)
    routerCache.set(def, compiled)
    routerCache.set(assigned, compiled)
    return def
  }

  // ─── Handler factory (Fetch API) ─────────────────────────────────

  const buildHandler: SilgiInstance<TBaseCtx>['handler'] = (routerDef, options) => {
    const prefix = options?.basePath ? normalizePrefix(options.basePath) : undefined
    const fetchHandler = wrapHandler(
      createFetchHandler(
        routerDef,
        contextFactory,
        hooks,
        prefix,
        bridge as import('./core/context-bridge.ts').ContextBridge,
      ),
      routerDef,
      options ? { ...options, schemaRegistry, hooks } : { schemaRegistry, hooks },
      prefix,
    )

    // Routes without any subscriptions go through the plain fetch
    // handler; we never even import the WS module.
    if (!routerHasSubscriptions(routerDef)) return fetchHandler

    // Lazy WS init. `/_ws` requests get a synthetic `Response` with
    // the crossws hooks attached on a side property — this is the
    // convention Nitro / h3 look for to mount the WebSocket upgrade.
    let wsHooks: Record<string, Function> | undefined
    let wsInitPromise: Promise<void> | undefined

    const initWsHooks = async (): Promise<void> => {
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
      const url = new URL(request.url)
      if (url.pathname === wsPath) {
        if (!wsHooks) {
          wsInitPromise ??= initWsHooks()
          await wsInitPromise
        }
        const response = new Response(null, { status: 200 })
        ;(response as unknown as { crossws: unknown }).crossws = wsHooks
        return response
      }
      return fetchHandler(request)
    }
  }

  // ─── serve() orchestrator ────────────────────────────────────────

  const buildServe: SilgiInstance<TBaseCtx>['serve'] = async (routerDef, options) => {
    const { createServeHandler } = await import('./core/serve.ts')
    const server = await createServeHandler(
      routerDef,
      contextFactory,
      hooks,
      options,
      schemaRegistry,
      bridge as import('./core/context-bridge.ts').ContextBridge,
    )

    // Cron auto-discovery. This currently uses the process-default
    // registry so the analytics dashboard (which reads
    // `getScheduledTasks()` from the same default) keeps showing
    // scheduled jobs. `createCronRegistry()` exists for users who want
    // fully-isolated registries; a future refactor will thread that
    // through the analytics route so this `serve()` can drop to
    // per-instance.
    const { collectCronTasks, startCronJobs, stopCronJobs } = await import('./core/task.ts')
    const cronTasks = collectCronTasks(routerDef)
    if (cronTasks.length > 0) {
      await startCronJobs(cronTasks)
      console.log(`  ${cronTasks.length} cron task(s) scheduled`)
    }

    // Wrap `close()` so an explicit shutdown always stops cron jobs.
    // We return a *new* object instead of mutating the srvx-owned
    // server — mutating it would surprise anyone who held a reference
    // through a non-silgi code path.
    const originalClose = server.close.bind(server)
    const wrappedClose = async (force?: boolean): Promise<void> => {
      stopCronJobs()
      return originalClose(force)
    }
    const silgiServer: SilgiServer = Object.assign(Object.create(Object.getPrototypeOf(server)), server, {
      close: wrappedClose,
    })

    // OS signal handling is opt-in. `gracefulShutdown` on srvx still
    // controls the HTTP drain; this flag only governs silgi's cron-stop
    // wiring to SIGINT / SIGTERM.
    if (options?.handleSignals) {
      const onSignal = () => {
        wrappedClose().catch(() => {})
      }
      process.once('SIGINT', onSignal)
      process.once('SIGTERM', onSignal)
    }

    return silgiServer
  }

  // ─── Assemble the instance ───────────────────────────────────────

  const instance: SilgiInstance<TBaseCtx> = {
    hook: hooks.hook.bind(hooks),
    removeHook: hooks.removeHook.bind(hooks),
    useStorage: (...args: Parameters<typeof import('./core/storage.ts').useStorage>) => {
      return readyPromise.then(() => import('./core/storage.ts')).then((m) => m.useStorage(...args)) as any
    },

    runInContext: <T>(ctx: TBaseCtx, fn: () => T): T => bridge.run(ctx, fn),
    currentContext: (): TBaseCtx | undefined => bridge.current(),
    ready: (): Promise<void> => readyPromise,

    guard: (fnOrConfig: any) => {
      if (typeof fnOrConfig === 'function') {
        return { kind: 'guard' as const, fn: fnOrConfig }
      }
      return { kind: 'guard' as const, fn: fnOrConfig.fn, errors: fnOrConfig.errors }
    },
    wrap: (fn) => ({ kind: 'wrap' as const, fn }),

    $resolve: ((fn: any) => createProcedure('query', fn)) as any,
    $input: ((schema: any) => startBuilder().$input(schema)) as any,
    $use: ((...middleware: any[]) => {
      const b = startBuilder() as any
      for (const m of middleware) b.$use(m)
      return b
    }) as any,
    $output: ((schema: any) => startBuilder().$output(schema)) as any,
    $errors: ((errors: any) => startBuilder().$errors(errors)) as any,
    $route: ((route: any) => startBuilder().$route(route)) as any,
    $meta: ((meta: any) => startBuilder().$meta(meta)) as any,

    subscription: ((...args: unknown[]) => createProcedure('subscription', ...args)) as SubscriptionFactory<TBaseCtx>,

    $task: ((cfg: any) => createTaskFromProcedure(cfg, cfg.resolve, null, null, ctxFactory, rootWrapsGetter)) as any,

    router: registerRouter,
    createCaller: (routerDef, options) => createCaller(routerDef, contextFactory, options),
    handler: buildHandler,
    serve: buildServe,
  }

  return instance
}
