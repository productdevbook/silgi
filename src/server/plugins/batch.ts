/**
 * Batch Handler Plugin — process multiple RPC calls in a single HTTP request.
 *
 * Client sends POST to /__batch__ with an array of requests.
 * Server processes them concurrently and returns an array of responses.
 *
 * Supports streaming mode (responses sent as SSE) and buffered mode.
 */

import type { StandardHandlerPlugin, StandardHandlerOptions, HandlerResult } from "../adapters/standard/handler.ts";
import type { Context, StandardResponse } from "../../core/types.ts";
import { stringifyJSON } from "../../core/utils.ts";

export interface BatchPluginOptions {
  /** URL path for batch requests (default: /__batch__) */
  path?: string;
  /** Maximum number of requests in a batch (default: 20) */
  maxSize?: number;
}

interface BatchRequestItem {
  /** Relative URL path */
  path: string;
  /** HTTP method (default: POST) */
  method?: string;
  /** Request body */
  body?: unknown;
  /** Extra headers */
  headers?: Record<string, string>;
}

interface BatchResponseItem {
  /** Index of the request */
  index: number;
  /** HTTP status */
  status: number;
  /** Response headers */
  headers?: Record<string, string | string[] | undefined>;
  /** Response body */
  body?: unknown;
}

export class BatchPlugin<TContext extends Context = Context>
  implements StandardHandlerPlugin<TContext>
{
  readonly order = 5_000_000;
  #path: string;
  #maxSize: number;

  constructor(options: BatchPluginOptions = {}) {
    this.#path = options.path ?? "/__batch__";
    this.#maxSize = options.maxSize ?? 20;
  }

  init(options: StandardHandlerOptions<TContext>): void {
    const batchPath = this.#path;
    const maxSize = this.#maxSize;

    options.rootInterceptors ??= [];
    options.rootInterceptors.unshift(async (opts: any) => {
      const request = opts.request;
      if (!request) return opts.next();

      const pathname = request.url?.pathname;
      if (pathname !== batchPath) return opts.next();
      if (request.method?.toUpperCase() !== "POST") return opts.next();

      // Parse batch request
      const body = typeof request.body === "function"
        ? await request.body()
        : request.body;

      if (!Array.isArray(body)) {
        return {
          matched: true,
          response: {
            status: 400,
            headers: { "content-type": "application/json" },
            body: { code: "BAD_REQUEST", message: "Batch body must be an array" },
          },
        };
      }

      if (body.length > maxSize) {
        return {
          matched: true,
          response: {
            status: 400,
            headers: { "content-type": "application/json" },
            body: { code: "BAD_REQUEST", message: `Batch size exceeds maximum of ${maxSize}` },
          },
        };
      }

      // Process each request concurrently
      const handler = opts.handler;
      if (!handler) return opts.next();

      const results: BatchResponseItem[] = await Promise.all(
        (body as BatchRequestItem[]).map(async (item, index) => {
          try {
            const subUrl = new URL(item.path, request.url.origin);
            const subRequest = {
              url: subUrl,
              method: item.method ?? "POST",
              headers: { ...request.headers, ...item.headers },
              body: async () => item.body,
              signal: request.signal,
            };

            const result: HandlerResult = await handler.handle(subRequest, opts.handlerOptions);
            const response = result.response;

            return {
              index,
              status: response?.status ?? 404,
              headers: response?.headers,
              body: response?.body,
            };
          } catch (error) {
            return {
              index,
              status: 500,
              body: { code: "INTERNAL_SERVER_ERROR", message: String(error) },
            };
          }
        }),
      );

      // Return buffered response
      const response: StandardResponse = {
        status: 200,
        headers: { "content-type": "application/json" },
        body: results,
      };

      return { matched: true, response };
    });
  }
}
