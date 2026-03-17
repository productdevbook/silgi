/**
 * Node.js HTTP adapter — for Express, standalone Node, etc.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { Context, StandardLazyRequest, StandardResponse } from "../../../core/types.ts";
import type { AnyRouter } from "../../router.ts";
import { StandardHandler, type StandardHandlerOptions } from "../standard/handler.ts";
import { once, parseEmptyableJSON, stringifyJSON } from "../../../core/utils.ts";
import type { Readable } from "node:stream";

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
    req: IncomingMessage,
    res: ServerResponse,
    options: { context: TContext },
  ): Promise<{ matched: boolean }> {
    const lazyRequest = toStandardLazyRequest(req, res);
    const result = await this.#handler.handle(lazyRequest, {
      context: options.context,
      prefix: this.#prefix,
    });

    if (!result.matched || !result.response) {
      return { matched: false };
    }

    await sendResponse(res, result.response);
    return { matched: true };
  }
}

function toStandardLazyRequest(req: IncomingMessage, res: ServerResponse): StandardLazyRequest {
  const protocol = (req.socket as any).encrypted ? "https:" : "http:";
  const host = req.headers.host ?? "localhost";
  const urlStr = (req as any).originalUrl ?? req.url ?? "/";
  const url = new URL(urlStr, `${protocol}//${host}`);

  // Create abort signal from response lifecycle
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  res.once("error", (err) => controller.abort(err));

  return {
    url,
    method: (req.method ?? "GET").toUpperCase(),
    headers: req.headers as Record<string, string | string[] | undefined>,
    body: once(async () => {
      // Check for pre-parsed body (Express, Fastify, etc.)
      if ("body" in req && (req as any).body !== undefined) {
        return (req as any).body;
      }

      const text = await streamToString(req);
      if (!text) return undefined;

      const ct = req.headers["content-type"] ?? "";
      if (ct.includes("application/json")) return parseEmptyableJSON(text);
      return parseEmptyableJSON(text);
    }),
    signal: controller.signal,
  };
}

function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    stream.on("error", reject);
  });
}

async function sendResponse(res: ServerResponse, response: StandardResponse): Promise<void> {
  // Set headers
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    res.setHeader(key, value);
  }

  res.statusCode = response.status;

  if (response.body === undefined) {
    res.end();
    return;
  }

  if (typeof response.body === "string") {
    res.end(response.body);
    return;
  }

  const body = stringifyJSON(response.body);
  res.end(body);
}
