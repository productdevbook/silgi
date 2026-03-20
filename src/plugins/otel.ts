/**
 * OpenTelemetry plugin — v2 wrap middleware.
 *
 * Wraps each procedure call in a span for distributed tracing.
 * Zero OTel dependencies — uses a lightweight Tracer interface.
 */

import type { WrapDef } from '../types.ts'

// ── Tracer Abstraction ──────────────────────────────

export interface Span {
  setAttribute(key: string, value: string | number | boolean): void
  setStatus(status: { code: number; message?: string }): void
  addEvent(name: string, attributes?: Record<string, unknown>): void
  end(): void
}

export interface Tracer {
  startSpan(name: string, options?: { attributes?: Record<string, string | number | boolean> }): Span
}

/**
 * Create an OTel tracing wrap middleware.
 *
 * @example
 * ```ts
 * import { otelWrap } from "katman/otel"
 * import { trace } from "@opentelemetry/api"
 *
 * const tracing = otelWrap(trace.getTracer("my-service"))
 *
 * const proc = k
 *   .$use(tracing)
 *   .$resolve(({ ctx }) => ctx.db.find())
 * ```
 */
export function otelWrap(tracer: Tracer, spanName = 'rpc.call'): WrapDef {
  return {
    kind: 'wrap',
    fn: async (_ctx, next) => {
      const span = tracer.startSpan(spanName, {
        attributes: { 'rpc.system': 'katman' },
      })

      try {
        const result = await next()
        span.setStatus({ code: 0 })
        return result
      } catch (error) {
        span.setStatus({ code: 2, message: String(error) })
        span.addEvent('exception', {
          'exception.message': error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        span.end()
      }
    },
  }
}
