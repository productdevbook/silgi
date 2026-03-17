/**
 * Fetch adapter — for Cloudflare Workers, Deno, Bun, etc.
 */

import type { Context, StandardLazyRequest, StandardResponse } from "../../../core/types.ts";
import type { AnyRouter } from "../../router.ts";
import { StandardHandler, type StandardHandlerOptions } from "../standard/handler.ts";
import { once, parseEmptyableJSON, stringifyJSON } from "../../../core/utils.ts";

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
    request: Request,
    options: { context: TContext },
  ): Promise<{ matched: boolean; response?: Response }> {
    const lazyRequest = toStandardLazyRequest(request);
    const result = await this.#handler.handle(lazyRequest, {
      context: options.context,
      prefix: this.#prefix,
    });

    if (!result.matched || !result.response) {
      return { matched: false };
    }

    return {
      matched: true,
      response: toFetchResponse(result.response),
    };
  }
}

function toStandardLazyRequest(request: Request): StandardLazyRequest {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });

  return {
    url,
    method: request.method,
    headers,
    body: once(async () => {
      const ct = request.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const text = await request.text();
        return parseEmptyableJSON(text);
      }
      if (ct.includes("multipart/form-data")) {
        return request.formData();
      }
      if (ct.includes("application/x-www-form-urlencoded")) {
        const text = await request.text();
        return new URLSearchParams(text);
      }
      const text = await request.text();
      return text ? parseEmptyableJSON(text) : undefined;
    }),
    signal: request.signal,
  };
}

function toFetchResponse(response: StandardResponse): Response {
  const headers = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.set(key, value);
    }
  }

  let body: BodyInit | undefined;
  if (response.body === undefined) {
    body = undefined;
  } else if (response.body instanceof Blob) {
    body = response.body;
  } else if (response.body instanceof FormData) {
    body = response.body;
  } else if (response.body instanceof URLSearchParams) {
    body = response.body;
  } else if (typeof response.body === "string") {
    body = response.body;
  } else {
    body = stringifyJSON(response.body);
  }

  return new Response(body, {
    status: response.status,
    headers,
  });
}
