/**
 * Fastify adapter — thin wrapper over the Node.js adapter.
 *
 * Fastify pre-parses bodies, so we prioritize Fastify's parsed body
 * over raw stream reading.
 */

import type { Context, StandardLazyRequest, StandardResponse } from "../../../core/types.ts";
import type { AnyRouter } from "../../router.ts";
import { StandardHandler, type StandardHandlerOptions } from "../standard/handler.ts";
import { once, stringifyJSON } from "../../../core/utils.ts";

export interface FastifyRequest {
  raw: import("node:http").IncomingMessage;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  url: string;
  method: string;
}

export interface FastifyReply {
  raw: import("node:http").ServerResponse;
  status(code: number): FastifyReply;
  headers(headers: Record<string, string | string[] | undefined>): FastifyReply;
  send(payload?: unknown): FastifyReply;
}

export interface RPCHandlerOptions<TContext extends Context = Context>
  extends StandardHandlerOptions<TContext> {
  prefix?: string;
}

export class RPCHandler<TContext extends Context = Context> {
  #handler: StandardHandler<TContext>;
  #prefix?: string;

  constructor(router: AnyRouter, options: RPCHandlerOptions<TContext> = {}) {
    this.#handler = new StandardHandler(router, options);
    this.#prefix = options.prefix;
  }

  async handle(
    request: FastifyRequest,
    reply: FastifyReply,
    options: { context: TContext },
  ): Promise<{ matched: boolean }> {
    const lazyRequest = toStandardLazyRequest(request, reply);
    const result = await this.#handler.handle(lazyRequest, {
      context: options.context,
      prefix: this.#prefix,
    });

    if (!result.matched || !result.response) {
      return { matched: false };
    }

    await sendResponse(reply, result.response);
    return { matched: true };
  }
}

function toStandardLazyRequest(req: FastifyRequest, reply: FastifyReply): StandardLazyRequest {
  const raw = req.raw;
  const protocol = (raw.socket as any).encrypted ? "https:" : "http:";
  const host = req.headers.host ?? "localhost";
  const url = new URL(req.url, `${protocol}//${host}`);

  const controller = new AbortController();
  reply.raw.once("close", () => controller.abort());
  reply.raw.once("error", (err) => controller.abort(err));

  return {
    url,
    method: req.method.toUpperCase(),
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: once(async () => {
      // Fastify pre-parses body — prefer it
      if (req.body !== undefined) return req.body;
      return undefined;
    }),
    signal: controller.signal,
  };
}

async function sendResponse(reply: FastifyReply, response: StandardResponse): Promise<void> {
  const headers: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(response.headers)) {
    if (value !== undefined) headers[key] = value;
  }

  reply.status(response.status);
  reply.headers(headers);

  if (response.body === undefined) {
    reply.send();
  } else if (typeof response.body === "string") {
    reply.send(response.body);
  } else {
    reply.send(stringifyJSON(response.body));
  }
}
