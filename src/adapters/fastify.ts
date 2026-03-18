/**
 * Fastify adapter — register katman router as a Fastify plugin.
 *
 * @example
 * ```ts
 * import Fastify from "fastify"
 * import { katmanFastify } from "katman/fastify"
 *
 * const app = Fastify()
 * app.register(katmanFastify(appRouter, { prefix: "/rpc", context: (req) => ({ user: req.user }) }))
 * app.listen({ port: 3000 })
 * ```
 */

import { compileRouter, type FlatRouter } from "../compile.ts";
import type { RouterDef } from "../types.ts";
import { KatmanError, toKatmanError } from "../core/error.ts";
import { ValidationError } from "../core/schema.ts";
import { stringifyJSON } from "../core/utils.ts";
import { encode as msgpackEncode, decode as msgpackDecode, acceptsMsgpack, isMsgpack, MSGPACK_CONTENT_TYPE } from "../codec/msgpack.ts";
import { encode as devalueEncode, decode as devalueDecode, acceptsDevalue, isDevalue, DEVALUE_CONTENT_TYPE } from "../codec/devalue.ts";

export interface KatmanFastifyOptions {
  /** URL prefix for all RPC routes (default: "/") */
  prefix?: string;
  /** Context factory — receives Fastify request */
  context?: (req: any) => Record<string, unknown> | Promise<Record<string, unknown>>;
}

/**
 * Create a Fastify plugin that registers all katman procedures as routes.
 */
export function katmanFastify(
  routerDef: RouterDef,
  options: KatmanFastifyOptions = {},
) {
  const flat: FlatRouter = compileRouter(routerDef);
  const prefix = options.prefix?.replace(/\/$/, "") ?? "";
  const contextFactory = options.context ?? (() => ({}));
  const signal = new AbortController().signal;

  return async function plugin(fastify: any) {
    // Register a catch-all route for RPC
    fastify.all(`${prefix}/*`, async (req: any, reply: any) => {
      const rawPath = req.url.replace(prefix + "/", "").split("?")[0];
      const route = flat.get(rawPath);

      if (!route) {
        reply.status(404).send({ code: "NOT_FOUND", status: 404, message: "Procedure not found" });
        return;
      }

      const ctx: Record<string, unknown> = Object.create(null);
      try {
        const baseCtx = await contextFactory(req);
        Object.assign(ctx, baseCtx);
      } catch (err) {
        const e = err instanceof KatmanError ? err : toKatmanError(err);
        reply.status(e.status).send(e.toJSON());
        return;
      }

      // Parse input
      let rawInput: unknown;
      const ct = req.headers["content-type"];
      if (isMsgpack(ct) && req.body) {
        rawInput = msgpackDecode(req.body instanceof Buffer ? req.body : Buffer.from(req.body));
      } else if (isDevalue(ct) && req.body) {
        rawInput = devalueDecode(typeof req.body === "string" ? req.body : JSON.stringify(req.body));
      } else if (req.body && typeof req.body === "object") {
        rawInput = req.body; // Fastify auto-parses JSON
      }

      try {
        const result = route.handler(ctx, rawInput ?? {}, signal);
        const output = result instanceof Promise ? await result : result;

        // Content negotiation
        const accept = req.headers.accept;
        if (acceptsMsgpack(accept)) {
          reply.header("content-type", MSGPACK_CONTENT_TYPE).send(Buffer.from(msgpackEncode(output) as ArrayBuffer));
        } else if (acceptsDevalue(accept)) {
          reply.header("content-type", DEVALUE_CONTENT_TYPE).send(devalueEncode(output));
        } else {
          reply.header("content-type", "application/json").send(route.stringify(output));
        }
      } catch (error) {
        if (error instanceof ValidationError) {
          reply.status(400).send({
            code: "BAD_REQUEST", status: 400, message: error.message,
            data: { issues: error.issues },
          });
          return;
        }
        const e = error instanceof KatmanError ? error : toKatmanError(error);
        reply.status(e.status).send(e.toJSON());
      }
    });
  };
}
