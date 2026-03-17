/**
 * CORS plugin.
 */

import type { StandardHandlerPlugin, StandardHandlerOptions } from "../adapters/standard/handler.ts";
import type { Context } from "../../core/types.ts";

export interface CORSOptions {
  origin?: string | string[] | ((origin: string) => boolean);
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export class CORSPlugin<TContext extends Context = Context>
  implements StandardHandlerPlugin<TContext>
{
  readonly order = 9_000_000;
  #options: CORSOptions;

  constructor(options: CORSOptions = {}) {
    this.#options = options;
  }

  init(options: StandardHandlerOptions<TContext>): void {
    const corsOpts = this.#options;

    options.rootInterceptors ??= [];
    options.rootInterceptors.push(async (opts) => {
      const result = await opts.next();

      if (!result.response) return result;

      const headers = { ...result.response.headers };

      // Determine allowed origin
      const origin = corsOpts.origin ?? "*";
      if (typeof origin === "string") {
        headers["access-control-allow-origin"] = origin;
      } else if (Array.isArray(origin)) {
        headers["access-control-allow-origin"] = origin.join(", ");
      }

      if (corsOpts.credentials) {
        headers["access-control-allow-credentials"] = "true";
      }

      if (corsOpts.methods) {
        headers["access-control-allow-methods"] = corsOpts.methods.join(", ");
      } else {
        headers["access-control-allow-methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
      }

      if (corsOpts.allowedHeaders) {
        headers["access-control-allow-headers"] = corsOpts.allowedHeaders.join(", ");
      } else {
        headers["access-control-allow-headers"] = "Content-Type, Authorization";
      }

      if (corsOpts.exposedHeaders) {
        headers["access-control-expose-headers"] = corsOpts.exposedHeaders.join(", ");
      }

      if (corsOpts.maxAge !== undefined) {
        headers["access-control-max-age"] = String(corsOpts.maxAge);
      }

      return {
        ...result,
        response: { ...result.response, headers },
      };
    });
  }
}
