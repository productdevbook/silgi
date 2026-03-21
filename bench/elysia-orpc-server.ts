/**
 * oRPC server for benchmark — with 5 middleware + validation + context
 *
 * Run: bun bench/elysia-orpc-server.ts
 */

import { os as orpcOs } from '@orpc/server'
import { RPCHandler } from '@orpc/server/fetch'
import { z } from 'zod'

const NameInput = z.object({ name: z.string() })

const orpcRouter = {
  greet: orpcOs
    .use(async ({ next }) => next({ context: { db: 'postgres' } }))
    .use(async ({ next }) => next({ context: { userId: 1 } }))
    .use(async ({ next }) => next({ context: { tenantId: 'acme' } }))
    .use(async ({ next }) => next({ context: { remaining: 99 } }))
    .use(async ({ next }) => next({ context: { requestId: 'req-123' } }))
    .use(async ({ next }) => next({ context: { role: 'admin' } }))
    .input(NameInput)
    .handler(async ({ input, context }) => ({
      hello: input.name,
      by: (context as any).userId,
      tenant: (context as any).tenantId,
      role: (context as any).role,
    })),
}

const handler = new RPCHandler(orpcRouter)

Bun.serve({
  port: 4402,
  hostname: '127.0.0.1',
  async fetch(request) {
    const { matched, response } = await handler.handle(request, { context: {} })
    if (matched) return response!
    return new Response('Not Found', { status: 404 })
  },
})

console.log('oRPC server listening on http://127.0.0.1:4402')
