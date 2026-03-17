/**
 * Pino logging plugin — structured logging for Katman handlers.
 *
 * Injects a child logger per request with request metadata.
 * Logs request lifecycle events: received, handled, errors.
 */

import type { Context } from "../../core/types.ts";
import type { StandardHandlerPlugin, StandardHandlerOptions } from "../../server/adapters/standard/handler.ts";

// === Logger Interface (compatible with Pino) ===

export interface Logger {
  child(bindings: Record<string, unknown>): Logger;
  info(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  debug(obj: Record<string, unknown>, msg?: string): void;
}

// === Context Symbol ===

const LOGGER_SYMBOL = Symbol.for("katman.pino.logger");

export interface LoggerContext {
  [LOGGER_SYMBOL]?: Logger;
}

/** Get the request-scoped logger from context */
export function getLogger(context: Context): Logger | undefined {
  return (context as LoggerContext)[LOGGER_SYMBOL];
}

// === Plugin ===

export interface LoggingPluginOptions {
  /** The root logger instance */
  logger: Logger;
  /** Generate a unique request ID (default: crypto.randomUUID) */
  generateId?: () => string;
  /** Log request received events (default: true) */
  logRequests?: boolean;
  /** Log response events (default: true) */
  logResponses?: boolean;
}

export class LoggingPlugin<TContext extends Context = Context>
  implements StandardHandlerPlugin<TContext>
{
  readonly order = 500_000;
  #logger: Logger;
  #generateId: () => string;
  #logRequests: boolean;
  #logResponses: boolean;

  constructor(options: LoggingPluginOptions) {
    this.#logger = options.logger;
    this.#generateId = options.generateId ?? (() => crypto.randomUUID());
    this.#logRequests = options.logRequests ?? true;
    this.#logResponses = options.logResponses ?? true;
  }

  init(options: StandardHandlerOptions<TContext>): void {
    const rootLogger = this.#logger;
    const generateId = this.#generateId;
    const logRequests = this.#logRequests;
    const logResponses = this.#logResponses;

    options.rootInterceptors ??= [];
    options.rootInterceptors.unshift(async (opts: any) => {
      const requestId = generateId();
      const request = opts.request;

      // Create child logger with request bindings
      const logger = rootLogger.child({
        "rpc.id": requestId,
        "rpc.system": "katman",
        ...(request?.url && { "http.url": request.url.pathname }),
        ...(request?.method && { "http.method": request.method }),
      });

      // Inject logger into context
      if (opts.handlerOptions?.context) {
        (opts.handlerOptions.context as LoggerContext)[LOGGER_SYMBOL] = logger;
      }

      if (logRequests) {
        logger.info({ requestId }, "request received");
      }

      const start = performance.now();

      try {
        const result = await opts.next();
        const duration = performance.now() - start;

        if (logResponses) {
          if (result.matched) {
            logger.info(
              { requestId, status: result.response?.status, duration: Math.round(duration) },
              "request handled",
            );
          } else {
            logger.info({ requestId, duration: Math.round(duration) }, "no matching procedure");
          }
        }

        return result;
      } catch (error) {
        const duration = performance.now() - start;

        // Distinguish abort errors from real errors
        if (error instanceof Error && error.name === "AbortError") {
          logger.info({ requestId, duration: Math.round(duration) }, "request aborted");
        } else {
          logger.error(
            {
              requestId,
              duration: Math.round(duration),
              error: error instanceof Error ? error.message : String(error),
            },
            "request error",
          );
        }

        throw error;
      }
    });
  }
}
