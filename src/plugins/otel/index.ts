/**
 * OpenTelemetry integration for Katman.
 *
 * Provides middleware and handler plugin for distributed tracing.
 * Uses a lightweight abstraction so the core has zero OTel dependencies.
 *
 * Usage:
 *   import { OTelPlugin } from "katman/plugins/otel"
 *   const handler = new RPCHandler(router, {
 *     plugins: [new OTelPlugin({ tracer })]
 *   })
 */

import type { Context } from "../../core/types.ts";
import type { Middleware, MiddlewareOptions, MiddlewareResult } from "../../core/pipeline.ts";
import type { StandardHandlerPlugin, StandardHandlerOptions } from "../../server/adapters/standard/handler.ts";

// === Tracer Abstraction ===

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  setStatus(status: { code: number; message?: string }): void;
  addEvent(name: string, attributes?: Record<string, unknown>): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): Span;
}

// === OTel Middleware ===

/**
 * Create middleware that wraps each procedure call in a span.
 */
export function createOTelMiddleware<TContext extends Context = Context>(
  tracer: Tracer,
): Middleware<TContext, TContext> {
  return (async (opts: MiddlewareOptions<TContext, unknown>, input: unknown) => {
    const span = tracer.startSpan("rpc.call", {
      attributes: {
        "rpc.system": "katman",
        "rpc.method": opts.path.join("."),
      },
    });

    try {
      const result = await opts.next();
      span.setStatus({ code: 0 }); // OK
      return result;
    } catch (error) {
      span.setStatus({ code: 2, message: String(error) }); // ERROR
      span.addEvent("exception", {
        "exception.message": error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      span.end();
    }
  }) as Middleware<TContext, TContext>;
}

// === OTel Handler Plugin ===

export interface OTelPluginOptions {
  tracer: Tracer;
}

export class OTelPlugin<TContext extends Context = Context>
  implements StandardHandlerPlugin<TContext>
{
  readonly order = 1_000_000;
  #tracer: Tracer;

  constructor(options: OTelPluginOptions) {
    this.#tracer = options.tracer;
  }

  init(options: StandardHandlerOptions<TContext>): void {
    const tracer = this.#tracer;

    options.rootInterceptors ??= [];
    options.rootInterceptors.unshift(async (opts: any) => {
      const request = opts.request;
      const span = tracer.startSpan("rpc.server.request", {
        attributes: {
          "rpc.system": "katman",
          "http.method": request?.method ?? "UNKNOWN",
          "http.url": request?.url?.pathname ?? "unknown",
        },
      });

      try {
        const result = await opts.next();
        if (result.matched) {
          span.setAttribute("http.status_code", result.response?.status ?? 200);
          span.setStatus({ code: 0 });
        } else {
          span.setAttribute("http.status_code", 404);
          span.setStatus({ code: 0, message: "not matched" });
        }
        return result;
      } catch (error) {
        span.setStatus({ code: 2, message: String(error) });
        span.addEvent("exception", {
          "exception.message": error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }
}
