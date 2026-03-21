/**
 * Silgi server for benchmark — Bun-native adapter, 5 middleware + validation + context
 *
 * Run: bun bench/elysia-silgi-server.ts
 */

import { z } from 'zod'

import { silgiBun } from '../src/adapters/bun.ts'
import { silgi } from '../src/silgi.ts'

const k = silgi({ context: () => ({}) })

const auth = k.guard(() => ({ userId: 1 }))
const tenant = k.guard(() => ({ tenantId: 'acme' }))
const rateLimit = k.guard(() => ({ remaining: 99 }))
const logger = k.guard(() => ({ requestId: 'req-123' }))
const permissions = k.guard(() => ({ role: 'admin' }))

const NameInput = z.object({ name: z.string() })

const router = k.router({
  greet: k
    .$use(auth)
    .$use(tenant)
    .$use(rateLimit)
    .$use(logger)
    .$use(permissions)
    .$input(NameInput)
    .$resolve(({ input, ctx }) => ({
      hello: input.name,
      by: ctx.userId,
      tenant: ctx.tenantId,
      role: ctx.role,
    })),
})

Bun.serve(
  silgiBun(router, {
    context: () => ({ db: 'postgres' }),
    port: 4400,
    hostname: '127.0.0.1',
  }),
)

console.log('Silgi server listening on http://127.0.0.1:4400')
