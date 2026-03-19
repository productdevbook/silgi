import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { createServerClient } from '#src/client/server.ts'
import { katman } from '#src/katman.ts'

const k = katman({ context: () => ({ db: 'test' }) })

describe('createServerClient()', () => {
  it('calls procedures in-process', async () => {
    const router = k.router({
      health: k.query(() => ({ status: 'ok' })),
      users: {
        list: k.query(z.object({ limit: z.number().optional() }), ({ input }) => ({ count: input.limit ?? 10 })),
      },
    })

    const client = createServerClient(router, {
      context: () => ({ db: 'test' }),
    })

    const health = await (client as any).health()
    expect(health).toEqual({ status: 'ok' })

    const users = await (client as any).users.list({ limit: 3 })
    expect(users).toEqual({ count: 3 })
  })
})
