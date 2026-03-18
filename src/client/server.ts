/**
 * Server-side client — call procedures directly without HTTP.
 *
 * Useful for SSR, server components, and testing where you want the
 * same typed client interface but without network overhead.
 *
 * @example
 * ```ts
 * import { createServerClient } from "katman/client/server"
 *
 * const client = createServerClient(appRouter, {
 *   context: () => ({ db: getDB() }),
 * })
 *
 * // Same typed API as the HTTP client — but runs in-process
 * const users = await client.users.list({ limit: 10 })
 * ```
 */

import type { RouterDef, ProcedureDef, InferClient } from "../types.ts";
import { compileProcedure, compileRouter, type FlatRouter, type CompiledHandler } from "../compile.ts";

export interface ServerClientOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — called for every procedure call */
  context: () => TCtx | Promise<TCtx>;
}

/**
 * Create a type-safe client that calls procedures directly in-process.
 *
 * No HTTP, no serialization, no network — just compiled pipeline execution.
 * Uses the same compiled handlers as serve() and handler().
 */
export function createServerClient<
  TRouter extends RouterDef,
  TCtx extends Record<string, unknown>,
>(
  router: TRouter,
  options: ServerClientOptions<TCtx>,
): InferClient<TRouter> {
  const flatRouter = compileRouter(router);
  return createServerProxy(flatRouter, options.context, []) as InferClient<TRouter>;
}

function createServerProxy(
  flatRouter: FlatRouter,
  contextFactory: () => Record<string, unknown> | Promise<Record<string, unknown>>,
  path: string[],
): unknown {
  const cache = new Map<string, unknown>();
  const signal = new AbortController().signal;

  const callProcedure = async (input?: unknown) => {
    const key = path.join("/");
    const route = flatRouter.get(key);
    if (!route) throw new Error(`Procedure not found: ${key}`);
    const ctx: Record<string, unknown> = Object.create(null);
    const baseCtx = await contextFactory();
    const keys = Object.keys(baseCtx);
    for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!];
    return route.handler(ctx, input, signal);
  };

  return new Proxy(callProcedure, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return undefined;
      let cached = cache.get(prop);
      if (!cached) {
        cached = createServerProxy(flatRouter, contextFactory, [...path, prop]);
        cache.set(prop, cached);
      }
      return cached;
    },
    apply(_target, _thisArg, args) {
      return callProcedure(args[0]);
    },
  });
}
