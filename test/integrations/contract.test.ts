/**
 * Contract-first workflow tests.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { compileProcedure } from '#src/compile.ts'
import { contract, implement } from '#src/contract.ts'

import type { InferContractClient } from '#src/contract.ts'

const UserSchema = z.object({ id: z.number(), name: z.string() })

describe('contract()', () => {
  it('defines an API contract', () => {
    const api = contract({
      health: { type: 'query' as const },
      users: {
        list: {
          type: 'query' as const,
          input: z.object({ limit: z.number().optional() }),
          output: z.array(UserSchema),
        },
        create: {
          type: 'mutation' as const,
          input: z.object({ name: z.string() }),
          output: UserSchema,
          errors: { CONFLICT: 409 as const },
        },
      },
    })

    expect(api.health.type).toBe('query')
    expect(api.users.list.type).toBe('query')
    expect(api.users.create.errors?.CONFLICT).toBe(409)
  })
})

describe('implement()', () => {
  it('creates a router from contract + implementations', () => {
    const api = contract({
      health: { type: 'query' as const },
      echo: {
        type: 'query' as const,
        input: z.object({ msg: z.string() }),
      },
    })

    const router = implement(api, {
      health: () => ({ status: 'ok' }),
      echo: ({ input }) => ({ echo: input.msg }),
    })

    expect(router.health).toBeTruthy()
    expect((router.health as any).type).toBe('query')
    expect((router.health as any).resolve).toBeTypeOf('function')
  })

  it('implemented procedures are executable', async () => {
    const api = contract({
      add: {
        type: 'query' as const,
        input: z.object({ a: z.number(), b: z.number() }),
      },
    })

    const router = implement(api, {
      add: ({ input }) => ({ sum: input.a + input.b }),
    })

    const handler = compileProcedure(router.add as any)
    const result = await handler({}, { a: 3, b: 4 }, AbortSignal.timeout(5000))
    expect(result).toEqual({ sum: 7 })
  })

  it('handles nested routers', () => {
    const api = contract({
      users: {
        list: { type: 'query' as const },
        admin: {
          ban: { type: 'mutation' as const, input: z.object({ id: z.number() }) },
        },
      },
    })

    const router = implement(api, {
      users: {
        list: () => [],
        admin: {
          ban: ({ input }) => ({ banned: input.id }),
        },
      },
    })

    expect((router.users as any).list.type).toBe('query')
    expect((router.users as any).admin.ban.type).toBe('mutation')
  })
})

describe('InferContractClient', () => {
  it('infers client types from contract', () => {
    const api = contract({
      health: { type: 'query' as const },
      users: {
        list: {
          type: 'query' as const,
          input: z.object({ limit: z.number() }),
          output: z.array(UserSchema),
        },
      },
    })

    type Client = InferContractClient<typeof api>

    // health: no input → () => Promise<unknown>
    expectTypeOf<Client['health']>().toBeFunction()

    // users.list: input → (input) => Promise<User[]>
    expectTypeOf<Client['users']['list']>().toBeFunction()
    expectTypeOf<Client['users']['list']>().parameter(0).toMatchTypeOf<{ limit: number }>()
  })
})
