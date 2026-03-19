/**
 * NestJS adapter — register Katman as a NestJS controller.
 *
 * @example
 * ```ts
 * // rpc.controller.ts
 * import { Controller, All, Req, Res } from "@nestjs/common"
 * import { katmanNestHandler } from "katman/nestjs"
 * import { appRouter } from "./rpc"
 *
 * const rpcHandler = katmanNestHandler(appRouter, {
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
import { KatmanError, toKatmanError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

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
export function katmanNestHandler<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: NestAdapterOptions<TCtx> = {},
): (req: any, res: any) => Promise<void> {
  const flatRouter = compileRouter(router)
  return async (req: any, res: any) => {
    // NestJS uses Express or Fastify under the hood
    // req.path gives the path after the controller prefix
    let pathname = req.params?.[0] ?? req.path ?? req.url ?? ''
    if (pathname.startsWith('/')) pathname = pathname.slice(1)

    const route = flatRouter('POST', '/' + pathname)?.data
    if (!route) {
      res.status(404).json({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })
      return
    }

    try {
      const ctx: Record<string, unknown> = Object.create(null)
      if (options.context) {
        const baseCtx = await options.context(req)
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }

      let input: unknown
      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        input = req.body
      } else if (req.query?.data) {
        input = typeof req.query.data === 'string' ? JSON.parse(req.query.data) : req.query.data
      }

      const ac = new AbortController()
      req.on?.('close', () => ac.abort())
      const output = await route.handler(ctx, input, ac.signal)
      res.json(output)
    } catch (error) {
      if (error instanceof ValidationError) {
        res
          .status(400)
          .json({ code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } })
        return
      }
      const e = error instanceof KatmanError ? error : toKatmanError(error)
      res.status(e.status).json(e.toJSON())
    }
  }
}

/**
 * Create a NestJS module configuration for Katman.
 *
 * Returns an object that can be used with NestJS's dynamic module pattern.
 */
export function createKatmanModule(router: RouterDef, options: NestAdapterOptions<any> = {}) {
  const handler = katmanNestHandler(router, options)
  return { handler, router }
}
