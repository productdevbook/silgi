import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { createServerClient } from '#src/client/server.ts'
import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

describe('createServerClient()', () => {
  it('calls procedures in-process', async () => {
    const router = k.router({
      health: k.$resolve(() => ({ status: 'ok' })),
      users: {
        list: k
          .$input(z.object({ limit: z.number().optional() }))
          .$resolve(({ input }) => ({ count: input.limit ?? 10 })),
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
