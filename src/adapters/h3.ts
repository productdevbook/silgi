/**
 * H3 v2 adapter — use Katman with Nitro, Nuxt, or any H3 server.
 *
 * @example
 * ```ts
 * import { H3 } from "h3"
 * import { katmanH3 } from "katman/h3"
 *
 * const app = new H3()
 * app.all("/rpc/**", katmanH3(appRouter, {
 *   context: (event) => ({ db: getDB(), user: event.context.user }),
 * }))
 * ```
 */

import type { RouterDef } from "../types.ts";
import { compileRouter } from "../compile.ts";
import { KatmanError, toKatmanError } from "../core/error.ts";
import { ValidationError } from "../core/schema.ts";

export interface H3AdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the H3 event */
  context?: (event: any) => TCtx | Promise<TCtx>;
  /** Route prefix to strip from the path. Default: "/rpc" */
  prefix?: string;
}

/**
 * Create an H3 v2 handler that routes to Katman procedures.
 *
 * H3 v2 uses `new H3()`, `defineHandler`, `event.req.json()`, etc.
 * Works with H3 v2, Nitro v3, and Nuxt 4.
 */
export function katmanH3<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: H3AdapterOptions<TCtx> = {},
): (event: any) => Promise<unknown> {
  const flatRouter = compileRouter(router);
  const prefix = options.prefix ?? "/rpc";
  const signal = new AbortController().signal;

  return async (event: any) => {
    // H3 v2: event.url is a URL object, event.req is a Request-like
    const url = event.url ?? new URL(event.req?.url ?? "/", "http://localhost");
    const pathname = extractPath(typeof url === "string" ? url : url.pathname, prefix);

    const route = flatRouter.get(pathname);
    if (!route) {
      // H3 v2: set status via event.res.headers or return with status
      if (event.res?.headers) event.res.headers.set("content-type", "application/json");
      return { code: "NOT_FOUND", status: 404, message: "Procedure not found" };
    }

    try {
      const ctx: Record<string, unknown> = Object.create(null);
      if (options.context) {
        const baseCtx = await options.context(event);
        const keys = Object.keys(baseCtx);
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!];
      }

      // Parse input — H3 v2 uses event.req.json() / event.url.searchParams
      let input: unknown;
      const method = event.req?.method ?? event.method ?? "GET";
      if (method === "POST" || method === "PUT" || method === "PATCH") {
        // H3 v2: event.req is Request-like with .json()
        if (typeof event.req?.json === "function") {
          input = await event.req.json().catch(() => undefined);
        } else {
          // Fallback: try readBody from h3
          try {
            const { readBody } = await import("h3");
            input = await readBody(event);
          } catch { /* ignore */ }
        }
      } else {
        // GET: check searchParams
        const searchParams = url.searchParams ?? new URLSearchParams();
        const data = searchParams.get("data");
        if (data) input = JSON.parse(data);
      }

      const output = await route.handler(ctx, input, signal);
      return output;
    } catch (error) {
      if (error instanceof ValidationError) {
        return { code: "BAD_REQUEST", status: 400, message: error.message, data: { issues: error.issues } };
      }
      const e = error instanceof KatmanError ? error : toKatmanError(error);
      return e.toJSON();
    }
  };
}

function extractPath(pathname: string, prefix: string): string {
  const qIdx = pathname.indexOf("?");
  const clean = qIdx === -1 ? pathname : pathname.slice(0, qIdx);
  if (clean.startsWith(prefix)) {
    const rest = clean.slice(prefix.length);
    return rest.startsWith("/") ? rest.slice(1) : rest;
  }
  return clean.startsWith("/") ? clean.slice(1) : clean;
}
