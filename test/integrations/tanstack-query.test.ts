/**
 * TanStack Query — v2 client end-to-end test.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { createClient } from '#src/client/client.ts'
import { createQueryUtils } from '#src/integrations/tanstack-query/index.ts'
import { silgi } from '#src/silgi.ts'

import type { ClientLink } from '#src/client/types.ts'

const k = silgi({ context: () => ({}) })
const appRouter = k.router({
  users: {
    list: k.$input(z.object({ limit: z.number().optional() })).$resolve(({ input }) => ({
      users: [{ id: 1, name: 'Alice' }].slice(0, input.limit ?? 10),
    })),
    get: k.$input(z.object({ id: z.number() })).$resolve(({ input }) => ({ id: input.id, name: 'Alice' })),
  },
})

const handle = k.handler(appRouter)

const localLink: ClientLink = {
  async call(path, input) {
    const res = await handle(
      new Request('http://localhost/' + path.join('/'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: input !== undefined ? JSON.stringify(input) : undefined,
      }),
    )
    return res.json()
  },
}

const client = createClient<any>(localLink)

describe('TanStack Query v2 integration', () => {
  it('queryOptions fetches data through v2 handler', async () => {
    const utils = createQueryUtils(client)
    const opts = utils.users.list.queryOptions({ input: { limit: 1 } })
    const data = await opts.queryFn({ signal: AbortSignal.timeout(5000) })
    expect(data.users).toHaveLength(1)
    expect(data.users[0].name).toBe('Alice')
  })

  it('mutationOptions calls v2 handler', async () => {
    const utils = createQueryUtils(client)
    const opts = utils.users.get.mutationOptions()
    const data = await opts.mutationFn({ id: 1 })
    expect(data.name).toBe('Alice')
  })

  it('queryKey is deterministic', () => {
    const utils = createQueryUtils(client)
    const k1 = utils.users.list.queryKey({ limit: 5 })
    const k2 = utils.users.list.queryKey({ limit: 5 })
    expect(k1).toEqual(k2)
  })

  it('key prefix for bulk invalidation', () => {
    const utils = createQueryUtils(client)
    const key = utils.users.key()
    expect(key[0]).toEqual(['users'])
  })
})
