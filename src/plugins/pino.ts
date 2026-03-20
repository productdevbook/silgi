/**
 * Pino logging plugin — v2 hook-based.
 *
 * Logs request lifecycle events via silgi hooks.
 */

// ── Logger Interface (Pino-compatible) ──────────────

export interface Logger {
  child(bindings: Record<string, unknown>): Logger
  info(obj: Record<string, unknown>, msg?: string): void
  error(obj: Record<string, unknown>, msg?: string): void
  warn(obj: Record<string, unknown>, msg?: string): void
  debug(obj: Record<string, unknown>, msg?: string): void
}

export interface LoggingOptions {
  /** The root logger instance */
  logger: Logger
  /** Log request received events (default: true) */
  logRequests?: boolean
  /** Log response events (default: true) */
  logResponses?: boolean
}

/**
 * Create logging hooks for silgi().
 *
 * @example
 * ```ts
 * import pino from "pino"
 * import { loggingHooks } from "silgi/pino"
 *
 * const k = silgi({
 *   context: (req) => ({}),
 *   hooks: loggingHooks({ logger: pino() }),
 * })
 * ```
 */
export function loggingHooks(options: LoggingOptions) {
  const { logger } = options
  const logRequests = options.logRequests ?? true
  const logResponses = options.logResponses ?? true

  return {
    ...(logRequests && {
      request: ({ path, input }: { path: string; input: unknown }) => {
        logger.info({ path, hasInput: input !== undefined }, 'request received')
      },
    }),
    ...(logResponses && {
      response: ({ path, durationMs }: { path: string; durationMs: number }) => {
        logger.info({ path, durationMs: Math.round(durationMs * 100) / 100 }, 'response sent')
      },
    }),
    error: ({ path, error }: { path: string; error: unknown }) => {
      logger.error({ path, error: error instanceof Error ? error.message : String(error) }, 'request error')
    },
  }
}
