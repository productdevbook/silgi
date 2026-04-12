/**
 * Client-side OpenTelemetry tracing plugin.
 *
 * Wraps each client call in a span for distributed tracing.
 * Uses the same Tracer interface as the server-side plugin.
 *
 * @example
 * ```ts
 * import { withOtel } from 'silgi/client/plugins'
 * import { trace } from '@opentelemetry/api'
 *
 * const link = withOtel(baseLink, {
 *   tracer: trace.getTracer('my-service'),
 * })
 * ```
 */

import type { Span, Tracer } from '../../plugins/otel.ts'
import type { ClientLink, ClientContext } from '../types.ts'

export interface ClientOtelOptions {
  tracer: Tracer
  /** Span name prefix (default: 'rpc.client') */
  spanName?: string
}

export function withOtel<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: ClientOtelOptions,
): ClientLink<TClientContext> {
  const { tracer, spanName = 'rpc.client' } = options

  return {
    async call(path, input, callOptions) {
      const rpcMethod = path.join('.')
      const span: Span = tracer.startSpan(`${spanName}/${rpcMethod}`, {
        attributes: {
          'rpc.system': 'silgi',
          'rpc.method': rpcMethod,
        },
      })

      try {
        const result = await link.call(path, input, callOptions)
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
