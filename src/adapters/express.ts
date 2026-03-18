/**
 * Express adapter — use Katman as Express middleware.
 *
 * @example
 * ```ts
 * import express from "express"
 * import { katmanExpress } from "katman/express"
 *
 * const app = express()
 * app.use("/rpc", katmanExpress(appRouter, {
 *   context: (req) => ({ db: getDB(), user: req.user }),
 * }))
 * app.listen(3000)
 * ```
 */

import type { RouterDef } from "../types.ts";
import { compileRouter } from "../compile.ts";
import { KatmanError, toKatmanError } from "../core/error.ts";
import { ValidationError } from "../core/schema.ts";

export interface ExpressAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Express request */
  context?: (req: any) => TCtx | Promise<TCtx>;
}

/**
 * Create Express middleware that routes to Katman procedures.
 *
 * Mount at a prefix — the remainder of the path is the procedure name.
 * Requires `express.json()` middleware for POST body parsing.
 */
export function katmanExpress<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: ExpressAdapterOptions<TCtx> = {},
): (req: any, res: any, next: any) => void {
  const flatRouter = compileRouter(router);
  const signal = new AbortController().signal;

  return (req: any, res: any, next: any) => {
    // Strip leading slash from the path after the mount prefix
    let pathname = req.path ?? req.url ?? "";
    if (pathname.startsWith("/")) pathname = pathname.slice(1);

    const route = flatRouter.get(pathname);
    if (!route) {
      // Pass to next middleware if not found
      return next();
    }

    const handle = async () => {
      try {
        const ctx: Record<string, unknown> = Object.create(null);
        if (options.context) {
          const baseCtx = await options.context(req);
          const keys = Object.keys(baseCtx);
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!];
        }

        // Input from body (POST) or query string (GET)
        let input: unknown;
        if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
          input = req.body;
        } else if (req.query?.data) {
          input = typeof req.query.data === "string" ? JSON.parse(req.query.data) : req.query.data;
        }

        const output = await route.handler(ctx, input, signal);
        res.json(output);
      } catch (error) {
        if (error instanceof ValidationError) {
          res.status(400).json({ code: "BAD_REQUEST", status: 400, message: error.message, data: { issues: error.issues } });
          return;
        }
        const e = error instanceof KatmanError ? error : toKatmanError(error);
        res.status(e.status).json(e.toJSON());
      }
    };

    handle();
  };
}
