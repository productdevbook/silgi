/**
 * AWS Lambda adapter — deploy Katman as a Lambda function.
 *
 * @example
 * ```ts
 * import { katmanLambda } from "katman/aws-lambda"
 *
 * export const handler = katmanLambda(appRouter, {
 *   context: (event) => ({ db: getDB(), userId: event.requestContext?.authorizer?.userId }),
 * })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { KatmanError, toKatmanError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { RouterDef } from '../types.ts'

export interface LambdaAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the Lambda event */
  context?: (event: LambdaEvent) => TCtx | Promise<TCtx>
  /** Route prefix to strip. Default: none */
  prefix?: string
}

interface LambdaEvent {
  httpMethod: string
  path: string
  body: string | null
  headers: Record<string, string>
  queryStringParameters: Record<string, string> | null
  requestContext?: Record<string, unknown>
  isBase64Encoded?: boolean
}

interface LambdaResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
}

/**
 * Create an AWS Lambda handler from a Katman router.
 *
 * Supports API Gateway v1 (REST) and v2 (HTTP) event formats.
 */
export function katmanLambda<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: LambdaAdapterOptions<TCtx> = {},
): (event: LambdaEvent) => Promise<LambdaResponse> {
  const flatRouter = compileRouter(router)
  const prefix = options.prefix ?? ''
  return async (event: LambdaEvent): Promise<LambdaResponse> => {
    let pathname = event.path
    if (prefix && pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
    }
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    const route = flatRouter.get(pathname)
    if (!route) {
      return {
        statusCode: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' }),
      }
    }

    try {
      const ctx: Record<string, unknown> = Object.create(null)
      if (options.context) {
        const baseCtx = await options.context(event)
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }

      // Parse input
      let input: unknown
      if (event.body) {
        const body = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf-8') : event.body
        try {
          input = JSON.parse(body)
        } catch {
          /* ignore */
        }
      } else if (event.queryStringParameters?.data) {
        try {
          input = JSON.parse(event.queryStringParameters.data)
        } catch {
          /* ignore */
        }
      }

      const signal = AbortSignal.timeout(30_000) // Lambda has a max timeout
      const output = await route.handler(ctx, input, signal)

      return {
        statusCode: 200,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(output),
      }
    } catch (error) {
      if (error instanceof ValidationError) {
        return {
          statusCode: 400,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            code: 'BAD_REQUEST',
            status: 400,
            message: error.message,
            data: { issues: error.issues },
          }),
        }
      }
      const e = error instanceof KatmanError ? error : toKatmanError(error)
      return {
        statusCode: e.status,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(e.toJSON()),
      }
    }
  }
}
