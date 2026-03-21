/**
 * Elysia server for benchmark — with 5 middleware + validation + context
 *
 * Same features as Silgi server.
 *
 * Run: bun bench/elysia-elysia-server.ts
 */

import { Elysia } from 'elysia'
import { z } from 'zod'

const NameInput = z.object({ name: z.string() })

const app = new Elysia()
  .derive(() => ({ db: 'postgres' as const }))
  .derive(() => ({ userId: 1 as const }))
  .derive(() => ({ tenantId: 'acme' as const }))
  .derive(() => ({ remaining: 99 as const }))
  .derive(() => ({ requestId: 'req-123' as const }))
  .derive(() => ({ role: 'admin' as const }))
  .post('/greet', ({ body, userId, tenantId, role }) => {
    const input = NameInput.parse(body)
    return {
      hello: input.name,
      by: userId,
      tenant: tenantId,
      role,
    }
  })

Bun.serve({
  port: 4401,
  hostname: '127.0.0.1',
  fetch: app.fetch,
})

console.log('Elysia server listening on http://127.0.0.1:4401')
