/**
 * defineRouteKit — factory-pattern route builder for isolated packages.
 */

import { describe, it, expect, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { defineRouteKit } from '#src/route-kit.ts'
import { silgi } from '#src/silgi.ts'

import type { ProcedureDef } from '#src/types.ts'

interface PackageCtx extends Record<string, unknown> {
  db: { users: { id: number; name: string }[] }
}

describe('defineRouteKit', () => {
  it('binds ctx at kit level, flows through to resolver', async () => {
    const kit = defineRouteKit<PackageCtx>()

    const listUsers = kit.route()(({ s }) =>
      s.$resolve(({ ctx }) => {
        expectTypeOf(ctx.db.users).toEqualTypeOf<{ id: number; name: string }[]>()
        return ctx.db.users
      }),
    )

    const k = silgi({ context: () => ({ db: { users: [{ id: 1, name: 'Alice' }] } }) })
    const proc = listUsers({ s: k })

    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { id: number; name: string }[], {}>>()

    const caller = k.createCaller(k.router({ listUsers: proc }))
    expect(await caller.listUsers()).toEqual([{ id: 1, name: 'Alice' }])
  })

  it('typed guards — ctx additions flow into $resolve', async () => {
    const kit = defineRouteKit<PackageCtx>()

    const createPost = kit.route<{
      auth: { userId: number }
      org: { orgId: string }
    }>()(({ s, auth, org }) =>
      s
        .$use(auth)
        .$use(org)
        .$input(z.object({ title: z.string() }))
        .$resolve(({ input, ctx }) => {
          expectTypeOf(ctx.userId).toEqualTypeOf<number>()
          expectTypeOf(ctx.orgId).toEqualTypeOf<string>()
          expectTypeOf(ctx.db.users).toEqualTypeOf<{ id: number; name: string }[]>()
          return { title: input.title, by: ctx.userId, org: ctx.orgId }
        }),
    )

    const k = silgi({ context: () => ({ db: { users: [] } }) })
    const authGuard = k.guard(() => ({ userId: 42 }))
    const orgGuard = k.guard(() => ({ orgId: 'acme' }))

    const proc = createPost({ s: k, auth: authGuard, org: orgGuard })
    const caller = k.createCaller(k.router({ createPost: proc }))
    expect(await caller.createPost({ title: 'hello' })).toEqual({
      title: 'hello',
      by: 42,
      org: 'acme',
    })
  })

  it('kit routes are identity — builder fn is returned unchanged', () => {
    const kit = defineRouteKit<PackageCtx>()
    const builder = ({ s }: { s: any }) => s.$resolve(() => 1)
    const defined = kit.route()(builder)
    expect(defined).toBe(builder)
  })
})
