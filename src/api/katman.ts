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
  InferContextFromUse,
} from "./types.ts";
import type { AnySchema, InferSchemaInput, InferSchemaOutput } from "../core/schema.ts";
import { compileProcedure, compileRouter, ContextPool, type CompiledHandler, type FlatRouter } from "./compile.ts";
import { KatmanError, toKatmanError, isErrorStatus } from "../core/error.ts";
import { ValidationError, validateSchema } from "../core/schema.ts";
import { stringifyJSON, parseEmptyableJSON, once } from "../core/utils.ts";
import { iteratorToEventStream } from "../core/sse.ts";

// ── Katman Instance ─────────────────────────────────

export interface KatmanConfig<TCtx extends Record<string, unknown>> {
  context: (req: Request) => TCtx | Promise<TCtx>;
}

export interface KatmanInstance<TBaseCtx extends Record<string, unknown>> {
  /** Create a guard middleware (flat, zero-closure) */
  guard: <TReturn extends Record<string, unknown> | void>(
    fn: GuardFn<TBaseCtx, TReturn>,
  ) => GuardDef<TBaseCtx, TReturn>;

  /** Create a wrap middleware (onion, before+after) */
  wrap: (fn: WrapFn<TBaseCtx>) => WrapDef<TBaseCtx>;

  /** Define a query (GET, cacheable, idempotent) */
  query: QueryFactory<TBaseCtx>;

  /** Define a mutation (POST, side effects) */
  mutation: MutationFactory<TBaseCtx>;

  /** Define a subscription (SSE stream) */
  subscription: SubscriptionFactory<TBaseCtx>;

  /** Assemble router and compile pipelines */
  router: <T extends RouterDef>(def: T) => T;

  /** Create a Fetch API handler: (Request) => Response */
  handler: (router: RouterDef) => (request: Request) => Promise<Response>;

  /** Create & start a Node.js HTTP server */
  serve: (router: RouterDef, options?: { port?: number; hostname?: string }) => void;
}

// ── Procedure Factories ──────────────────────────────

interface QueryFactory<TBaseCtx> {
  // Short: query(resolve)
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<"query", undefined, TOutput, {}>;

  // Short: query(input, resolve)
  <TInput, TOutput>(
    input: AnySchema,
    resolve: (opts: ResolveContext<TBaseCtx, TInput, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<"query", TInput, TOutput, {}>;

  // Config: query({ use, input, output, errors, resolve })
  <TInput, TOutput, TErrors extends ErrorDef, const TUse extends readonly MiddlewareDef[]>(
    config: ProcedureConfig<TBaseCtx, TInput, TOutput, TErrors, TUse>,
  ): ProcedureDef<"query", TInput, TOutput, TErrors>;
}

interface MutationFactory<TBaseCtx> {
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<"mutation", undefined, TOutput, {}>;

  <TInput, TOutput>(
    input: AnySchema,
    resolve: (opts: ResolveContext<TBaseCtx, TInput, {}>) => Promise<TOutput> | TOutput,
  ): ProcedureDef<"mutation", TInput, TOutput, {}>;

  <TInput, TOutput, TErrors extends ErrorDef, const TUse extends readonly MiddlewareDef[]>(
    config: ProcedureConfig<TBaseCtx, TInput, TOutput, TErrors, TUse>,
  ): ProcedureDef<"mutation", TInput, TOutput, TErrors>;
}

interface SubscriptionFactory<TBaseCtx> {
  <TOutput>(
    resolve: (opts: ResolveContext<TBaseCtx, undefined, {}>) => AsyncIterableIterator<TOutput>,
  ): ProcedureDef<"subscription", undefined, TOutput, {}>;

  <TInput, TOutput>(
    input: AnySchema,
    resolve: (opts: ResolveContext<TBaseCtx, TInput, {}>) => AsyncIterableIterator<TOutput>,
  ): ProcedureDef<"subscription", TInput, TOutput, {}>;

  <TInput, TOutput, TErrors extends ErrorDef, const TUse extends readonly MiddlewareDef[]>(
    config: ProcedureConfig<TBaseCtx, TInput, TOutput, TErrors, TUse>,
  ): ProcedureDef<"subscription", TInput, TOutput, TErrors>;
}

// ── Implementation ──────────────────────────────────

function createProcedure(type: ProcedureType, ...args: unknown[]): ProcedureDef {
  // Short form: (resolve)
  if (args.length === 1 && typeof args[0] === "function") {
    return {
      type,
      input: null,
      output: null,
      errors: null,
      use: null,
      resolve: args[0] as Function,
      route: null,
    };
  }

  // Short form: (input, resolve)
  if (args.length === 2 && typeof args[1] === "function") {
    return {
      type,
      input: args[0] as AnySchema,
      output: null,
      errors: null,
      use: null,
      resolve: args[1] as Function,
      route: null,
    };
  }

  // Config form: ({ use, input, output, errors, resolve, ... })
  const config = args[0] as ProcedureConfig<any, any, any, any, any>;
  return {
    type,
    input: config.input ?? null,
    output: config.output ?? null,
    errors: config.errors ?? null,
    use: config.use ?? null,
    resolve: config.resolve,
    route: config.route ?? null,
  };
}

export function katman<TBaseCtx extends Record<string, unknown>>(
  config: KatmanConfig<TBaseCtx>,
): KatmanInstance<TBaseCtx> {
  const contextFactory = config.context;

  const instance: KatmanInstance<TBaseCtx> = {
    guard: (fn) => ({ kind: "guard" as const, fn }),
    wrap: (fn) => ({ kind: "wrap" as const, fn }),

    query: ((...args: unknown[]) => createProcedure("query", ...args)) as QueryFactory<TBaseCtx>,
    mutation: ((...args: unknown[]) => createProcedure("mutation", ...args)) as MutationFactory<TBaseCtx>,
    subscription: ((...args: unknown[]) => createProcedure("subscription", ...args)) as SubscriptionFactory<TBaseCtx>,

    router: (def) => {
      assignPaths(def);
      // Compile to flat Map — O(1) lookup at request time
      const flat = compileRouter(def);
      routerCache.set(def, flat);
      return def;
    },

    handler: (routerDef) => createFetchHandler(routerDef, contextFactory),

    serve: (routerDef, options) => {
      // Compile flat router ONCE
      let flatRouter = routerCache.get(routerDef);
      if (!flatRouter) {
        flatRouter = compileRouter(routerDef);
        routerCache.set(routerDef, flatRouter);
      }

      const port = options?.port ?? 3000;
      const hostname = options?.hostname ?? "127.0.0.1";
      const pool = new ContextPool();
      const fr = flatRouter;

      import("node:http").then(({ createServer }) => {
        const server = createServer((req, res) => {
          // FAST NODE HANDLER — no Request/Response objects, no URL parsing
          (async () => {
            // Fast pathname extraction from Node req.url
            const rawUrl = req.url ?? "/";
            const qIdx = rawUrl.indexOf("?");
            const pathname = qIdx === -1 ? rawUrl.slice(1) : rawUrl.slice(1, qIdx);

            // O(1) flat Map lookup
            const pipeline = fr.get(pathname);
            if (!pipeline) {
              res.statusCode = 404;
              res.setHeader("content-type", "application/json");
              res.end('{"code":"NOT_FOUND","status":404,"message":"Not found"}');
              return;
            }

            // Borrow context from pool
            const ctx = pool.borrow();

            try {
              // Build context — pass Node headers directly (no Headers conversion)
              const baseCtx = contextFactory(new Request(
                `http://${req.headers.host ?? "localhost"}${rawUrl}`,
                { method: req.method, headers: req.headers as any },
              ));
              const resolved = baseCtx instanceof Promise ? await baseCtx : baseCtx;
              const keys = Object.keys(resolved);
              for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = resolved[keys[i]!];

              // Parse body — direct stream read, no Request wrapper
              let rawInput: unknown;
              const method = req.method ?? "GET";
              if (method !== "GET" && method !== "HEAD") {
                const text: string = await new Promise((resolve) => {
                  const chunks: Buffer[] = [];
                  req.on("data", (c: Buffer) => chunks.push(c));
                  req.on("end", () => resolve(Buffer.concat(chunks).toString()));
                });
                if (text) rawInput = JSON.parse(text);
              }

              // Execute compiled pipeline
              const output = await pipeline(ctx, rawInput, AbortSignal.timeout(30_000));

              // Write response directly — no Response object
              res.statusCode = 200;
              res.setHeader("content-type", "application/json");
              res.end(stringifyJSON(output));
            } catch (err) {
              if (!res.headersSent) {
                const e = err instanceof KatmanError ? err : toKatmanError(err);
                res.statusCode = e.status;
                res.setHeader("content-type", "application/json");
                res.end(stringifyJSON(e.toJSON()));
              }
            } finally {
              pool.release(ctx);
            }
          })().catch((err) => {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end('{"code":"INTERNAL_SERVER_ERROR","status":500,"message":"Internal error"}');
            }
          });
        });

        server.listen(port, hostname, () => {
          console.log(`\nKatman server running at http://${hostname}:${port}\n`);
        });
      });
    },
  };

  return instance;
}

// ── Flat Router Cache ───────────────────────────────

const routerCache = new WeakMap<RouterDef, FlatRouter>();

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "resolve" in value &&
    typeof (value as ProcedureDef).resolve === "function"
  );
}

// ── Auto Path Assignment ────────────────────────────

function assignPaths(def: RouterDef, prefix: string[] = []): void {
  for (const [key, value] of Object.entries(def)) {
    const currentPath = [...prefix, key];
    if (isProcedureDef(value)) {
      if (!value.route) {
        (value as any).route = { path: "/" + currentPath.join("/") };
      }
    } else if (typeof value === "object" && value !== null) {
      assignPaths(value as RouterDef, currentPath);
    }
  }
}

// ── Fetch Handler ───────────────────────────────────

function createFetchHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
): (request: Request) => Promise<Response> {
  // Get or compile the flat router map — O(1) lookup
  let flatRouter = routerCache.get(routerDef);
  if (!flatRouter) {
    flatRouter = compileRouter(routerDef);
    routerCache.set(routerDef, flatRouter);
  }

  // Context pool — zero allocation per request
  const ctxPool = new ContextPool();

  // Pre-allocate response headers (reused across requests)
  const jsonHeaders = { "content-type": "application/json" };
  const sseHeaders = { "content-type": "text/event-stream", "cache-control": "no-cache" };
  const notFoundBody = JSON.stringify({ code: "NOT_FOUND", status: 404, message: "Procedure not found" });

  return async (request: Request): Promise<Response> => {
    // FAST pathname extraction — 40x faster than new URL()
    const url = request.url;
    const pathStart = url.indexOf("/", url.indexOf("//") + 2);
    const qMark = url.indexOf("?", pathStart);
    const pathname = qMark === -1 ? url.slice(pathStart + 1) : url.slice(pathStart + 1, qMark);

    // O(1) flat Map lookup
    const pipeline = flatRouter!.get(pathname);
    if (!pipeline) {
      return new Response(notFoundBody, { status: 404, headers: jsonHeaders });
    }

    // Borrow context from pool
    const ctx = ctxPool.borrow();

    try {
      // Populate context — direct property copy instead of Object.assign
      const baseCtx = await contextFactory(request);
      const keys = Object.keys(baseCtx);
      for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!];

      // Parse input — use .json() directly when possible
      let rawInput: unknown;
      if (request.method === "GET") {
        if (qMark !== -1) {
          const searchStr = url.slice(qMark + 1);
          const dataIdx = searchStr.indexOf("data=");
          if (dataIdx !== -1) {
            const valueStart = dataIdx + 5;
            const valueEnd = searchStr.indexOf("&", valueStart);
            const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd);
            rawInput = JSON.parse(decodeURIComponent(encoded));
          }
        }
      } else {
        const ct = request.headers.get("content-type");
        if (ct?.includes("json") && request.body) {
          rawInput = await request.json();
        } else if (request.body) {
          const text = await request.text();
          rawInput = text ? parseEmptyableJSON(text) : undefined;
        }
      }

      // Execute compiled pipeline
      const output = await pipeline(ctx, rawInput, request.signal);

      // SSE streaming
      if (output && typeof output === "object" && Symbol.asyncIterator in (output as object)) {
        const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>);
        return new Response(stream, { headers: sseHeaders });
      }

      // JSON response
      return new Response(stringifyJSON(output), { status: 200, headers: jsonHeaders });
    } catch (error) {
      if (error instanceof ValidationError) {
        return new Response(
          JSON.stringify({ code: "BAD_REQUEST", status: 400, message: error.message, data: { issues: error.issues } }),
          { status: 400, headers: jsonHeaders },
        );
      }
      const e = error instanceof KatmanError ? error : toKatmanError(error);
      return new Response(stringifyJSON(e.toJSON()), { status: e.status, headers: jsonHeaders });
    } finally {
      // Return context to pool
      ctxPool.release(ctx);
    }
  };
}

// ── Re-exports ──────────────────────────────────────

export { KatmanError, toKatmanError, isErrorStatus } from "../core/error.ts";
export { type, validateSchema, ValidationError } from "../core/schema.ts";
