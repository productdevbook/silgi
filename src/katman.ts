/**
 * katman() — the main entry point.
 *
 * Creates a Katman instance with typed context.
 * All procedure/middleware factories are methods on this instance,
 * so context type flows automatically.
 *
 * Usage:
 *   const k = katman({ context: (req) => ({ db, headers }) })
 *   export const { query, mutation, guard, wrap, router, handler } = k
 */

import { defu } from 'defu'
import { getPort } from 'get-port-please'
import { createHooks } from 'hookable'

import {
  encode as devalueEncode,
  decode as devalueDecode,
  acceptsDevalue,
  isDevalue,
  DEVALUE_CONTENT_TYPE,
} from './codec/devalue.ts'
import {
  encode as msgpackEncode,
  decode as msgpackDecode,
  acceptsMsgpack,
  isMsgpack,
  MSGPACK_CONTENT_TYPE,
} from './codec/msgpack.ts'
import { compileProcedure, compileRouter, ContextPool } from './compile.ts'
import { KatmanError, toKatmanError, isErrorStatus } from './core/error.ts'
import { ValidationError, validateSchema } from './core/schema.ts'
import { iteratorToEventStream } from './core/sse.ts'
import { stringifyJSON, parseEmptyableJSON, once } from './core/utils.ts'
import { generateOpenAPI, scalarHTML, resolveScalarLocal } from './scalar.ts'

import type { CompiledHandler, FlatRouter } from './compile.ts'
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from './core/schema.ts'
import type { ScalarOptions } from './scalar.ts'
import type {
  ProcedureDef,
  ProcedureType,
  ProcedureConfig,
  ErrorDef,
  GuardDef,
  WrapDef,
  GuardFn,
  WrapFn,
  MiddlewareDef,
  ResolveContext,
  RouterDef,
  Route,
  Meta,
  InferContextFromUse,
  InferErrorsFromUse,
} from './types.ts'
import type { Hookable, HookCallback } from 'hookable'

// ── Lifecycle Hooks ─────────────────────────────────

export interface KatmanHooks {
  /** Called before a request is processed */
  request: (event: { path: string; input: unknown }) => void
  /** Called after a successful response */
  response: (event: { path: string; output: unknown; durationMs: number }) => void
  /** Called when an error occurs */
  error: (event: { path: string; error: unknown }) => void
  /** Called when the server starts */
  'serve:start': (event: { url: string; port: number; hostname: string }) => void
}

// ── Katman Instance ─────────────────────────────────

export interface KatmanConfig<TCtx extends Record<string, unknown>> {
  context: (req: Request) => TCtx | Promise<TCtx>
  /** Register lifecycle hooks */
  hooks?: Partial<{ [K in keyof KatmanHooks]: KatmanHooks[K] | KatmanHooks[K][] }>
}

export interface KatmanInstance<TBaseCtx extends Record<string, unknown>> {
  /** Register a lifecycle hook */
  hook: Hookable<KatmanHooks>['hook']

  /** Remove a lifecycle hook */
  removeHook: Hookable<KatmanHooks>['removeHook']
  /** Create a guard middleware (flat, zero-closure) */
  guard: GuardFactory<TBaseCtx>

  /** Create a wrap middleware (onion, before+after) */
  wrap: (fn: WrapFn<TBaseCtx>) => WrapDef<TBaseCtx>

  /** Define a query (GET, cacheable, idempotent) */
  query: QueryFactory<TBaseCtx>

  /** Define a mutation (POST, side effects) */
  mutation: MutationFactory<TBaseCtx>

  /** Define a subscription (SSE stream) */
  subscription: SubscriptionFactory<TBaseCtx>

  /** Assemble router and compile pipelines */
  router: <T extends RouterDef>(def: T) => T

  /** Create a Fetch API handler: (Request) => Response */
  handler: (router: RouterDef) => (request: Request) => Promise<Response>

  /** Create & start a Node.js HTTP server */
  serve: (
    router: RouterDef,
    options?: {
      port?: number
      hostname?: string
      /** Enable Scalar API Reference UI at /reference and /openapi.json */
      scalar?: boolean | ScalarOptions
      /** Enable WebSocket RPC (requires crossws) */
      ws?: boolean
      /** Enable HTTP/2 (requires cert + key for TLS) */
      http2?: { cert: string; key: string }
    },
  ) => void
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

interface QueryFactory<TBaseCtx> {
  // Short: query(resolve)
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<'query', undefined, TOutput, {}>

  // Short: query(input, resolve)
  <TSchema extends AnySchema, TOutput>(
    input: TSchema,
    resolve: (opts: ResolveContext<TBaseCtx, InferSchemaOutput<TSchema>, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<'query', InferSchemaInput<TSchema>, TOutput, {}>

  // Config with output schema — resolve return type enforced + autocomplete
  <
    TErrors extends ErrorDef,
    const TUse extends readonly MiddlewareDef[],
    TOutputSchema extends AnySchema,
    TInputSchema extends AnySchema | undefined = undefined,
    /** @internal Pre-resolved output type for IDE autocomplete */
    TResolved extends InferSchemaInput<TOutputSchema> = InferSchemaInput<TOutputSchema>,
  >(
    config: {
      use?: TUse
      input?: TInputSchema
      output: TOutputSchema
      errors?: TErrors
      resolve: (
        opts: ResolveContext<
          InferContextFromUse<TUse, TBaseCtx>,
          TInputSchema extends AnySchema ? InferSchemaOutput<TInputSchema> : undefined,
          NoInfer<TErrors> & InferErrorsFromUse<TUse>
        >,
      ) => Promise<NoInfer<TResolved>> | NoInfer<TResolved>
      route?: Route
      meta?: Meta
    },
  ): ProcedureDef<
    'query',
    TInputSchema extends AnySchema ? InferSchemaInput<TInputSchema> : undefined,
    InferSchemaOutput<TOutputSchema>,
    TErrors
  >

  // Config without output — resolve return freely inferred
  <
    TOutput,
    TErrors extends ErrorDef,
    const TUse extends readonly MiddlewareDef[],
    TInputSchema extends AnySchema | undefined = undefined,
  >(
    config: ProcedureConfig<TBaseCtx, TInputSchema, TOutput, TErrors, TUse>,
  ): ProcedureDef<
    'query',
    TInputSchema extends AnySchema ? InferSchemaInput<TInputSchema> : undefined,
    TOutput,
    TErrors
  >
}

interface MutationFactory<TBaseCtx> {
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<'mutation', undefined, TOutput, {}>

  <TSchema extends AnySchema, TOutput>(
    input: TSchema,
    resolve: (opts: ResolveContext<TBaseCtx, InferSchemaOutput<TSchema>, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<'mutation', InferSchemaInput<TSchema>, TOutput, {}>

  // Config with output schema
  <
    TErrors extends ErrorDef,
    const TUse extends readonly MiddlewareDef[],
    TOutputSchema extends AnySchema,
    TInputSchema extends AnySchema | undefined = undefined,
    TResolved extends InferSchemaInput<TOutputSchema> = InferSchemaInput<TOutputSchema>,
  >(
    config: {
      use?: TUse
      input?: TInputSchema
      output: TOutputSchema
      errors?: TErrors
      resolve: (
        opts: ResolveContext<
          InferContextFromUse<TUse, TBaseCtx>,
          TInputSchema extends AnySchema ? InferSchemaOutput<TInputSchema> : undefined,
          NoInfer<TErrors> & InferErrorsFromUse<TUse>
        >,
      ) => Promise<NoInfer<TResolved>> | NoInfer<TResolved>
      route?: Route
      meta?: Meta
    },
  ): ProcedureDef<
    'mutation',
    TInputSchema extends AnySchema ? InferSchemaInput<TInputSchema> : undefined,
    InferSchemaOutput<TOutputSchema>,
    TErrors
  >

  // Config without output
  <
    TOutput,
    TErrors extends ErrorDef,
    const TUse extends readonly MiddlewareDef[],
    TInputSchema extends AnySchema | undefined = undefined,
  >(
    config: ProcedureConfig<TBaseCtx, TInputSchema, TOutput, TErrors, TUse>,
  ): ProcedureDef<
    'mutation',
    TInputSchema extends AnySchema ? InferSchemaInput<TInputSchema> : undefined,
    TOutput,
    TErrors
  >
}

interface SubscriptionFactory<TBaseCtx> {
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => AsyncIterableIterator<TOutput>,
  ): ProcedureDef<'subscription', undefined, TOutput, {}>

  <TSchema extends AnySchema, TOutput>(
    input: TSchema,
    resolve: (opts: ResolveContext<TBaseCtx, InferSchemaOutput<TSchema>, {}>) => AsyncIterableIterator<TOutput>,
  ): ProcedureDef<'subscription', InferSchemaInput<TSchema>, TOutput, {}>

  // Config with output schema
  <
    TErrors extends ErrorDef,
    const TUse extends readonly MiddlewareDef[],
    TOutputSchema extends AnySchema,
    TInputSchema extends AnySchema | undefined = undefined,
    TResolved extends InferSchemaInput<TOutputSchema> = InferSchemaInput<TOutputSchema>,
  >(
    config: {
      use?: TUse
      input?: TInputSchema
      output: TOutputSchema
      errors?: TErrors
      resolve: (
        opts: ResolveContext<
          InferContextFromUse<TUse, TBaseCtx>,
          TInputSchema extends AnySchema ? InferSchemaOutput<TInputSchema> : undefined,
          NoInfer<TErrors> & InferErrorsFromUse<TUse>
        >,
      ) => Promise<NoInfer<TResolved>> | NoInfer<TResolved>
      route?: Route
      meta?: Meta
    },
  ): ProcedureDef<
    'subscription',
    TInputSchema extends AnySchema ? InferSchemaInput<TInputSchema> : undefined,
    InferSchemaOutput<TOutputSchema>,
    TErrors
  >

  // Config without output
  <
    TOutput,
    TErrors extends ErrorDef,
    const TUse extends readonly MiddlewareDef[],
    TInputSchema extends AnySchema | undefined = undefined,
  >(
    config: ProcedureConfig<TBaseCtx, TInputSchema, TOutput, TErrors, TUse>,
  ): ProcedureDef<
    'subscription',
    TInputSchema extends AnySchema ? InferSchemaInput<TInputSchema> : undefined,
    TOutput,
    TErrors
  >
}

// ── Implementation ──────────────────────────────────

function createProcedure(type: ProcedureType, ...args: unknown[]): ProcedureDef {
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

  // Config form: ({ use, input, output, errors, resolve, ... })
  const config = args[0] as ProcedureConfig<any, any, any, any, any>
  return {
    type,
    input: config.input ?? null,
    output: config.output ?? null,
    errors: config.errors ?? null,
    use: config.use ?? null,
    resolve: config.resolve,
    route: config.route ?? null,
    meta: config.meta ?? null,
  }
}

/**
 * Create a Katman RPC instance with typed context.
 *
 * @example
 * ```ts
 * const k = katman({
 *   context: (req) => ({ db: getDB(), user: getUser(req) }),
 *   hooks: {
 *     request: ({ path }) => console.log(`-> ${path}`),
 *   },
 * })
 * const { query, mutation, guard, wrap, router, serve } = k
 * ```
 */
export function katman<TBaseCtx extends Record<string, unknown>>(
  config: KatmanConfig<TBaseCtx>,
): KatmanInstance<TBaseCtx> {
  const contextFactory = config.context

  // Lifecycle hooks (sync fast-path when no hooks registered)
  const hooks = createHooks<KatmanHooks>()
  if (config.hooks) {
    for (const [name, fn] of Object.entries(config.hooks)) {
      if (Array.isArray(fn)) {
        for (const f of fn) hooks.hook(name as keyof KatmanHooks, f as any)
      } else if (fn) {
        hooks.hook(name as keyof KatmanHooks, fn as any)
      }
    }
  }

  const instance: KatmanInstance<TBaseCtx> = {
    hook: hooks.hook,
    removeHook: hooks.removeHook.bind(hooks),

    guard: (fnOrConfig: any) => {
      if (typeof fnOrConfig === 'function') {
        return { kind: 'guard' as const, fn: fnOrConfig }
      }
      return { kind: 'guard' as const, fn: fnOrConfig.fn, errors: fnOrConfig.errors }
    },
    wrap: (fn) => ({ kind: 'wrap' as const, fn }),

    query: ((...args: unknown[]) => createProcedure('query', ...args)) as QueryFactory<TBaseCtx>,
    mutation: ((...args: unknown[]) => createProcedure('mutation', ...args)) as MutationFactory<TBaseCtx>,
    subscription: ((...args: unknown[]) => createProcedure('subscription', ...args)) as SubscriptionFactory<TBaseCtx>,

    router: (def) => {
      assignPaths(def)
      const flat = compileRouter(def)
      routerCache.set(def, flat)
      return def
    },

    handler: (routerDef) => createFetchHandler(routerDef, contextFactory, hooks),

    serve: (routerDef, options) => {
      // Compile flat router ONCE
      let flatRouter = routerCache.get(routerDef)
      if (!flatRouter) {
        flatRouter = compileRouter(routerDef)
        routerCache.set(routerDef, flatRouter)
      }

      const opts = defu(options ?? {}, { port: 3000, hostname: '127.0.0.1' })
      const hostname = opts.hostname
      const fr = flatRouter
      // Per-request AbortController created inside handler below
      const scalarEnabled = !!options?.scalar

      const notFound = '{"code":"NOT_FOUND","status":404,"message":"Not found"}'

      const useHttp2 = !!options?.http2
      const useWs = !!options?.ws

      // Find available port, then start server
      Promise.all([
        getPort({ port: opts.port, host: hostname, alternativePortRange: [3000, 3100] }),
        useHttp2 ? import('node:http2') : import('node:http'),
      ]).then(async ([port, httpMod]) => {
        // Scalar API Reference (needs resolved port for URL)
        let specJson: string | undefined
        let specHtml: string | undefined
        let scalarLocalJs: string | undefined
        if (scalarEnabled) {
          const scalarOpts = typeof options!.scalar === 'object' ? options!.scalar : {}
          const spec = generateOpenAPI(routerDef, scalarOpts)
          specJson = JSON.stringify(spec)
          specHtml = scalarHTML(`http://${hostname}:${port}/openapi.json`, scalarOpts)
          // Pre-load local Scalar JS if cdn: 'local'
          if (scalarOpts.cdn === 'local') {
            const content = await resolveScalarLocal()
            if (!content) {
              console.warn(
                '  [katman] cdn: "local" requires @scalar/api-reference installed.\n' +
                  '           Run: pnpm add @scalar/api-reference\n' +
                  '           Falling back to CDN.',
              )
              specHtml = scalarHTML(`http://${hostname}:${port}/openapi.json`, { ...scalarOpts, cdn: 'cdn' })
            } else {
              scalarLocalJs = content
            }
          }
        }
        const handler = (req: any, res: any) => {
          const rawUrl = req.url ?? '/'
          const qIdx = rawUrl.indexOf('?')
          const pathname = qIdx === -1 ? rawUrl.slice(1) : rawUrl.slice(1, qIdx)

          // Scalar routes (only if enabled)
          if (scalarEnabled) {
            if (pathname === 'openapi.json') {
              res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(specJson!) })
              res.end(specJson)
              return
            }
            if (pathname === 'reference') {
              res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(specHtml!) })
              res.end(specHtml)
              return
            }
            if (pathname === '__katman/scalar.js' && scalarLocalJs) {
              res.writeHead(200, {
                'content-type': 'application/javascript',
                'content-length': Buffer.byteLength(scalarLocalJs),
                'cache-control': 'public, max-age=86400',
              })
              res.end(scalarLocalJs)
              return
            }
          }

          const route = fr.get(pathname)
          if (!route) {
            res.writeHead(404, { 'content-type': 'application/json', 'content-length': notFound.length })
            res.end(notFound)
            return
          }

          // FIX #1: No Proxy — plain object with iterable protocol (saves 200-500ns/req)
          // FIX #2: Object literal with stable hidden class (not Object.create(null))
          const hdrs = req.headers
          const iterableHeaders: any = {}
          const hkeys = Object.keys(hdrs)
          for (let i = 0; i < hkeys.length; i++) {
            const k = hkeys[i]!
            const v = hdrs[k]
            iterableHeaders[k] = Array.isArray(v) ? v[0] : v
          }
          iterableHeaders[Symbol.iterator] = function* () {
            for (const k of hkeys) {
              const v = hdrs[k]
              if (v !== undefined) yield [k, Array.isArray(v) ? v[0] : v]
            }
          }

          const fakeReq = {
            url: `http://${hdrs.host ?? 'localhost'}${rawUrl}`,
            method: req.method,
            headers: iterableHeaders,
          }

          // FIX #3: No per-request closures — inline respond/error logic
          // FIX #2b: Don't use pool (delete causes V8 dictionary mode)
          const ctx: Record<string, unknown> = Object.create(null)
          const ac = new AbortController()
          req.on('close', () => ac.abort())

          const t0 = performance.now()

          const respond = async (output: unknown) => {
            // Raw Response passthrough
            if (output instanceof Response) {
              res.writeHead(output.status, Object.fromEntries(output.headers))
              if (output.body) {
                const reader = output.body.getReader()
                const pump = async () => {
                  while (true) {
                    const { done, value } = await reader.read()
                    if (done) break
                    res.write(value)
                  }
                  res.end()
                }
                await pump()
              } else {
                res.end(await output.text())
              }
              hooks.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
              return
            }

            // ReadableStream passthrough
            if (output instanceof ReadableStream) {
              res.writeHead(200, { 'content-type': 'application/octet-stream' })
              const reader = (output as ReadableStream<Uint8Array>).getReader()
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                res.write(value)
              }
              res.end()
              hooks.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
              return
            }

            const body = route.stringify(output)
            const headers: Record<string, string | number> = {
              'content-type': 'application/json',
              'content-length': Buffer.byteLength(body),
            }
            if (route.cacheControl) headers['cache-control'] = route.cacheControl
            res.writeHead(200, headers)
            res.end(body)
            hooks.callHook('response', { path: pathname, output, durationMs: performance.now() - t0 })
          }

          const handleError = (err: unknown) => {
            if (!res.headersSent) {
              const e = err instanceof KatmanError ? err : toKatmanError(err)
              const body = stringifyJSON(e.toJSON())
              res.writeHead(e.status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
              res.end(body)
            }
            hooks.callHook('error', { path: pathname, error: err })
          }

          const runWithContext = (rawInput: unknown) => {
            try {
              const baseCtx = contextFactory(fakeReq as any)
              if (baseCtx instanceof Promise) {
                baseCtx
                  .then((resolved) => {
                    const keys = Object.keys(resolved)
                    for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = resolved[keys[i]!]
                    executePipeline(rawInput)
                  })
                  .catch(handleError)
              } else {
                const keys = Object.keys(baseCtx)
                for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
                executePipeline(rawInput)
              }
            } catch (err) {
              handleError(err)
            }
          }

          const executePipeline = (rawInput: unknown) => {
            try {
              const pr = route.handler(ctx, rawInput, ac.signal)
              if (pr instanceof Promise) {
                pr.then(respond).catch(handleError)
              } else {
                respond(pr)
              }
            } catch (err) {
              handleError(err)
            }
          }

          // NO BODY: sync fast path
          const cl = hdrs['content-length']
          const method = req.method ?? 'GET'
          if (!cl || cl === '0' || method === 'GET' || method === 'HEAD') {
            if (cl) req.resume()
            hooks.callHook('request', { path: pathname, input: undefined })
            runWithContext(undefined)
            return
          }

          // WITH BODY: callback-based (with size limit and parse safety)
          const MAX_BODY_SIZE = 1_048_576 // 1 MB default
          let body = ''
          let aborted = false
          req.on('data', (d: Buffer) => {
            if (aborted) return
            if (body.length + d.length > MAX_BODY_SIZE) {
              aborted = true
              req.destroy()
              handleError(new KatmanError('PAYLOAD_TOO_LARGE', { status: 413, message: 'Request body too large' }))
              return
            }
            body += d
          })
          req.on('end', () => {
            if (aborted) return
            let input: unknown
            try {
              input = body ? JSON.parse(body) : undefined
            } catch {
              handleError(new KatmanError('BAD_REQUEST', { status: 400, message: 'Invalid JSON body' }))
              return
            }
            hooks.callHook('request', { path: pathname, input })
            runWithContext(input)
          })
        }

        // Create server (HTTP/1.1 or HTTP/2)
        let server: any
        if (useHttp2 && options?.http2) {
          const h2 = httpMod as typeof import('node:http2')
          const fs = await import('node:fs')
          server = h2.createSecureServer(
            {
              cert: fs.readFileSync(options.http2.cert),
              key: fs.readFileSync(options.http2.key),
              allowHTTP1: true, // fallback for non-h2 clients
            },
            handler,
          )
        } else {
          const h1 = httpMod as typeof import('node:http')
          server = h1.createServer({ keepAlive: true, requestTimeout: 30_000, headersTimeout: 10_000 }, handler)
        }

        // Attach WebSocket if enabled
        if (useWs) {
          const { attachWebSocket } = await import('./ws.ts')
          attachWebSocket(server, routerDef)
        }

        const protocol = useHttp2 ? 'https' : 'http'
        server.listen(port, hostname, () => {
          const url = `${protocol}://${hostname}:${port}`
          console.log(`\nKatman server running at ${url}`)
          if (useHttp2) console.log(`  HTTP/2 enabled (with HTTP/1.1 fallback)`)
          if (useWs) console.log(`  WebSocket RPC at ws://${hostname}:${port}`)
          if (scalarEnabled) console.log(`  Scalar API Reference at ${url}/reference`)
          console.log()
          hooks.callHook('serve:start', { url, port, hostname })
        })
      })
    },
  }

  return instance
}

// ── Flat Router Cache ───────────────────────────────

const routerCache = new WeakMap<RouterDef, FlatRouter>()

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'resolve' in value &&
    typeof (value as ProcedureDef).resolve === 'function'
  )
}

// ── Auto Path Assignment ────────────────────────────

function assignPaths(def: RouterDef, prefix: string[] = []): void {
  for (const [key, value] of Object.entries(def)) {
    const currentPath = [...prefix, key]
    if (isProcedureDef(value)) {
      if (!value.route) {
        ;(value as any).route = { path: '/' + currentPath.join('/') }
      }
    } else if (typeof value === 'object' && value !== null) {
      assignPaths(value as RouterDef, currentPath)
    }
  }
}

// ── Response Encoding Helper ────────────────────────

type ResponseFormat = 'json' | 'msgpack' | 'devalue'

function encodeResponse(
  data: unknown,
  status: number,
  format: ResponseFormat,
  jsonStringify?: (v: unknown) => string,
  extraHeaders?: Record<string, string>,
): Response {
  switch (format) {
    case 'msgpack':
      return new Response(msgpackEncode(data), {
        status,
        headers: { 'content-type': MSGPACK_CONTENT_TYPE, ...extraHeaders },
      })
    case 'devalue':
      return new Response(devalueEncode(data), {
        status,
        headers: { 'content-type': DEVALUE_CONTENT_TYPE, ...extraHeaders },
      })
    default:
      return new Response(jsonStringify ? jsonStringify(data) : stringifyJSON(data), {
        status,
        headers: { 'content-type': 'application/json', ...extraHeaders },
      })
  }
}

// ── Fetch Handler ───────────────────────────────────

function createFetchHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<KatmanHooks>,
): (request: Request) => Promise<Response> {
  // Get or compile the flat router map — O(1) lookup
  let flatRouter = routerCache.get(routerDef)
  if (!flatRouter) {
    flatRouter = compileRouter(routerDef)
    routerCache.set(routerDef, flatRouter)
  }

  // Context pool — zero allocation per request
  const ctxPool = new ContextPool()

  // Pre-allocate response headers (reused across requests)
  const jsonHeaders = { 'content-type': 'application/json' }
  const msgpackHeaders = { 'content-type': MSGPACK_CONTENT_TYPE }
  const devalueHeaders = { 'content-type': DEVALUE_CONTENT_TYPE }
  const sseHeaders = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  return async (request: Request): Promise<Response> => {
    // FAST pathname extraction — 40x faster than new URL()
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const pathname = qMark === -1 ? url.slice(pathStart + 1) : url.slice(pathStart + 1, qMark)

    // O(1) flat Map lookup
    const route = flatRouter!.get(pathname)
    if (!route) {
      return new Response(notFoundBody, { status: 404, headers: jsonHeaders })
    }

    // Borrow context from pool
    const ctx = ctxPool.borrow()

    try {
      // Populate context — direct property copy instead of Object.assign
      const baseCtx = await contextFactory(request)
      const keys = Object.keys(baseCtx)
      for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]

      // Parse input — use .json() directly when possible
      let rawInput: unknown
      if (request.method === 'GET') {
        if (qMark !== -1) {
          const searchStr = url.slice(qMark + 1)
          const dataIdx = searchStr.indexOf('data=')
          if (dataIdx !== -1) {
            const valueStart = dataIdx + 5
            const valueEnd = searchStr.indexOf('&', valueStart)
            const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
            rawInput = JSON.parse(decodeURIComponent(encoded))
          }
        }
      } else {
        const ct = request.headers.get('content-type')
        if (isMsgpack(ct) && request.body) {
          const buf = new Uint8Array(await request.arrayBuffer())
          rawInput = msgpackDecode(buf)
        } else if (isDevalue(ct) && request.body) {
          rawInput = devalueDecode(await request.text())
        } else if (ct?.includes('json') && request.body) {
          rawInput = await request.json()
        } else if (request.body) {
          const text = await request.text()
          rawInput = text ? parseEmptyableJSON(text) : undefined
        }
      }

      const t0 = performance.now()
      hooks?.callHook('request', { path: pathname, input: rawInput })

      // Execute compiled pipeline — sync dispatch when possible
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      // Raw Response passthrough — full control over headers, status, body
      if (output instanceof Response) {
        hooks?.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
        return output
      }

      // ReadableStream passthrough — binary downloads, file streaming
      if (output instanceof ReadableStream) {
        hooks?.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
        return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
      }

      // SSE streaming
      if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
        const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
        return new Response(stream, { headers: sseHeaders })
      }

      // Content negotiation: msgpack > devalue > json
      hooks?.callHook('response', { path: pathname, output, durationMs: performance.now() - t0 })
      const accept = request.headers.get('accept')
      const fmt = acceptsMsgpack(accept) ? 'msgpack' : acceptsDevalue(accept) ? 'devalue' : 'json'
      const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
      return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
    } catch (error) {
      hooks?.callHook('error', { path: pathname, error })
      const accept = request.headers.get('accept')
      const fmt = acceptsMsgpack(accept) ? 'msgpack' : acceptsDevalue(accept) ? 'devalue' : 'json'
      if (error instanceof ValidationError) {
        const errBody = { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
        return encodeResponse(errBody, 400, fmt)
      }
      const e = error instanceof KatmanError ? error : toKatmanError(error)
      return encodeResponse(e.toJSON(), e.status, fmt)
    } finally {
      ctxPool.release(ctx)
    }
  }
}

// ── Re-exports ──────────────────────────────────────

export { KatmanError, toKatmanError, isErrorStatus } from './core/error.ts'
export { type, validateSchema, ValidationError } from './core/schema.ts'
