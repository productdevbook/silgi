/**
 * AWS Lambda adapter — deploy Silgi as a Lambda function.
 *
 * @example
 * ```ts
 * import { createHandler } from "silgi/aws-lambda"
 *
 * export const handler = createHandler(appRouter, {
 *   context: (event) => ({ db: getDB(), userId: event.requestContext?.authorizer?.userId }),
 * })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { buildContext, isMethodAllowed, serializeError, parseQueryData } from '../core/dispatch.ts'

import type { RouterDef } from '../types.ts'

export interface LambdaAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Lambda event */
  context?: (event: LambdaEvent) => TCtx | Promise<TCtx>
  /** Route prefix to strip. Default: none */
  prefix?: string
}

interface LambdaEvent {
  // v1 (REST API) fields
  httpMethod?: string
  path?: string
  // v2 (HTTP API) fields
  version?: string
  rawPath?: string
  requestContext?: {
    http?: { method: string; path: string }
    [key: string]: unknown
  }
  // Shared fields
  body: string | null
  headers: Record<string, string>
  queryStringParameters: Record<string, string> | null
  isBase64Encoded?: boolean
}

interface LambdaContext {
  getRemainingTimeInMillis?: () => number
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

/**
 * Create an AWS Lambda handler from a Silgi router.
 *
 * Supports API Gateway v1 (REST) and v2 (HTTP) event formats.
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: LambdaAdapterOptions<TCtx> = {},
): (event: LambdaEvent, context?: LambdaContext) => Promise<LambdaResponse> {
  const flatRouter = compileRouter(router)
  const prefix = options.prefix ?? ''
  const JSON_HDR = { 'content-type': 'application/json' }

  return async (event: LambdaEvent, context?: LambdaContext): Promise<LambdaResponse> => {
    // Detect API Gateway v2 (HTTP API) vs v1 (REST API)
    const isV2 = event.version === '2.0'
    const method = isV2 ? (event.requestContext?.http?.method ?? 'GET') : (event.httpMethod ?? 'GET')
    let pathname = isV2 ? (event.rawPath ?? '/') : (event.path ?? '/')

    if (prefix && pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
    }
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    const match = flatRouter(method, '/' + pathname)
    if (!match) {
      return {
        statusCode: 404,
        headers: JSON_HDR,
        body: JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }),
      }
    }
    const route = match.data

    // Method enforcement
    if (!isMethodAllowed(method, route.method)) {
      return {
        statusCode: 405,
        headers: { ...JSON_HDR, allow: route.method },
        body: JSON.stringify({ code: 'METHOD_NOT_ALLOWED', status: 405, message: `Method ${method} not allowed` }),
      }
    }

    try {
      const baseCtx = options.context ? await options.context(event) : undefined
      const ctx = buildContext(baseCtx as Record<string, unknown> | undefined, match.params)

      // Parse input
      let input: unknown
      if (event.body) {
        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body
        try {
          input = JSON.parse(body)
        } catch {
          return {
            statusCode: 400,
            headers: JSON_HDR,
            body: JSON.stringify({ code: 'BAD_REQUEST', status: 400, message: 'Invalid JSON body' }),
          }
        }
      } else if (event.queryStringParameters?.data) {
        input = parseQueryData(event.queryStringParameters.data)
      }

      // Use Lambda context's remaining time if available, otherwise fall back to 30s
      const timeoutMs = context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() - 500 : 30_000
      const signal = AbortSignal.timeout(Math.max(timeoutMs, 1000))
      const output = await route.handler(ctx, input, signal)

      return {
        statusCode: 200,
        headers: JSON_HDR,
        body: JSON.stringify(output),
      }
    } catch (error) {
      const body = serializeError(error)
      return {
        statusCode: body.status,
        headers: JSON_HDR,
        body: JSON.stringify(body),
      }
    }
  }
}
