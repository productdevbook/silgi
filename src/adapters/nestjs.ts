/**
 * NestJS adapter — register Silgi as a NestJS controller.
 *
 * @example
 * ```ts
 * // rpc.controller.ts
 * import { Controller, All, Req, Res } from "@nestjs/common"
 * import { createHandler } from "silgi/nestjs"
 * import { appRouter } from "./rpc"
 *
 * const rpcHandler = createHandler(appRouter, {
 *   context: (req) => ({ db: getDB(), user: req.user }),
 * })
 *
 * @Controller("rpc")
 * export class RpcController {
 *   @All("*")
 *   async handle(@Req() req: Request, @Res() res: Response) {
 *     return rpcHandler(req, res)
 *   }
 * }
 * ```
 */

import { compileRouter } from '../compile.ts'
import { buildContext, serializeError, parseQueryData } from '../core/dispatch.ts'

import type { RouterDef } from '../types.ts'

export interface NestAdapterOptions<TCtx extends Record<string, unknown>> {
  /** Context factory — receives the NestJS/Express request */
  context?: (req: any) => TCtx | Promise<TCtx>
}

/**
 * Create a NestJS-compatible handler function.
 *
 * Use inside a `@Controller` with `@All("*")`.
 * Handles routing internally — NestJS only needs to mount the prefix.
 */
export function createHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: NestAdapterOptions<TCtx> = {},
): (req: any, res: any) => Promise<void> {
  const flatRouter = compileRouter(router)
  return async (req: any, res: any) => {
    // NestJS uses Express or Fastify under the hood
    // req.path gives the path after the controller prefix
    let pathname = req.params?.[0] ?? req.path ?? req.url ?? ''
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    const match = flatRouter(req.method, '/' + pathname)
    if (!match) {
      res.status(404).json({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })
      return
    }
    const route = match.data

    try {
      const baseCtx = options.context ? await options.context(req) : undefined
      const ctx = buildContext(baseCtx as Record<string, unknown> | undefined, match.params)

      let input: unknown
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        input = req.body
      } else if (req.query?.data) {
        input = typeof req.query.data === 'string' ? parseQueryData(req.query.data) : req.query.data
      }

      const ac = new AbortController()
      req.on?.('close', () => ac.abort())
      const output = await route.handler(ctx, input, ac.signal)
      res.json(output)
    } catch (error) {
      const body = serializeError(error)
      res.status(body.status).json(body)
    }
  }
}

/**
 * Create a NestJS module configuration for Silgi.
 *
 * Returns an object that can be used with NestJS's dynamic module pattern.
 */
export function createModule(router: RouterDef, options: NestAdapterOptions<any> = {}) {
  const handler = createHandler(router, options)
  return { handler, router }
}
