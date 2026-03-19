import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { katman } from '#src/katman.ts'

import type { ProcedureDef, InferClient } from '#src/types.ts'

const k = katman({
  context: (req: Request) => ({
    headers: Object.fromEntries(req.headers) as Record<string, string>,
    db: { users: [] as { id: number; name: string }[] },
  }),
})

// ── Input type inference ────────────────────────────

describe('query/mutation input type inference', () => {
  const userSchema = z.object({ name: z.string(), age: z.number() })
  type UserInput = z.input<typeof userSchema>
  type UserOutput = z.output<typeof userSchema>

  it('short form: query(schema, resolve) — input is inferred', () => {
    const proc = k.query(userSchema, ({ input }) => {
      // input should be the validated (output) type of the schema
      expectTypeOf(input).toEqualTypeOf<UserOutput>()
      return { ok: true }
    })
    // ProcedureDef TInput should be the schema input type (what clients send)
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', UserInput, { ok: boolean }, {}>>()
  })

  it('short form: mutation(schema, resolve) — input is inferred', () => {
    const proc = k.mutation(userSchema, ({ input }) => {
      expectTypeOf(input).toEqualTypeOf<UserOutput>()
      return { created: true }
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', UserInput, { created: boolean }, {}>>()
  })

  it('config form: query({ input, resolve }) — input is inferred', () => {
    const proc = k.query({
      input: userSchema,
      resolve: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<UserOutput>()
        return { ok: true }
      },
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', UserInput, { ok: boolean }, {}>>()
  })

  it('config form: mutation({ input, resolve }) — input is inferred', () => {
    const proc = k.mutation({
      input: userSchema,
      resolve: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<UserOutput>()
        return { ok: true }
      },
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', UserInput, { ok: boolean }, {}>>()
  })

  it('no-input query: resolve gets undefined', () => {
    const proc = k.query(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<undefined>()
      return 42
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, number, {}>>()
  })
})

// ── Context type inference ──────────────────────────

describe('context type inference', () => {
  it('base context flows into resolve', () => {
    k.query(({ ctx }) => {
      expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
      expectTypeOf(ctx.db.users).toEqualTypeOf<{ id: number; name: string }[]>()
      return true
    })
  })

  it('guard enriches context', () => {
    const auth = k.guard(() => ({ user: { id: 1, role: 'admin' as const } }))

    k.query({
      use: [auth],
      resolve: ({ ctx }) => {
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: number; role: 'admin' }>()
        expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
        return true
      },
    })
  })

  it('multiple guards accumulate context', () => {
    const auth = k.guard(() => ({ user: { id: 1 } }))
    const org = k.guard(() => ({ orgId: 'abc' }))

    k.query({
      use: [auth, org],
      resolve: ({ ctx }) => {
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: number }>()
        expectTypeOf(ctx.orgId).toEqualTypeOf<string>()
        return true
      },
    })
  })
})

// ── Error / fail type inference ─────────────────────

describe('error type inference', () => {
  it('fail() is typed from errors config', () => {
    k.query({
      errors: {
        NOT_FOUND: 404,
        BAD_INPUT: { status: 400, data: z.object({ field: z.string() }) },
      },
      resolve: ({ fail }) => {
        // fail should accept error codes from the errors config
        expectTypeOf(fail).parameter(0).toEqualTypeOf<'NOT_FOUND' | 'BAD_INPUT'>()
        return true
      },
    })
  })
})

// ── Output type inference ───────────────────────────

describe('output type inference', () => {
  it('ProcedureDef TOutput is inferred from resolve return', () => {
    const proc = k.query(() => ({ count: 42, items: ['a', 'b'] }))
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { count: number; items: string[] }, {}>>()
  })
})

// ── Schema transform (input ≠ output) ───────────────

describe('schema with transform', () => {
  const dateSchema = z.string().transform((s) => new Date(s))

  it('resolve input is the transformed type, ProcedureDef TInput is the raw type', () => {
    const proc = k.query(dateSchema, ({ input }) => {
      // After validation, input should be Date (schema output)
      expectTypeOf(input).toEqualTypeOf<Date>()
      return input.toISOString()
    })
    // Client sends string (schema input), ProcedureDef captures that
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', string, string, {}>>()
  })

  it('config form with transform schema', () => {
    const proc = k.mutation({
      input: dateSchema,
      resolve: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<Date>()
        return { saved: true }
      },
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', string, { saved: boolean }, {}>>()
  })
})

// ── fail() data parameter ───────────────────────────

describe('fail() data parameter typing', () => {
  it('fail with data schema requires typed second arg', () => {
    k.query({
      errors: {
        VALIDATION: { status: 400, data: z.object({ field: z.string(), message: z.string() }) },
        NOT_FOUND: 404,
      },
      resolve: ({ fail }) => {
        // fail("VALIDATION") should require data: { field: string, message: string }
        expectTypeOf(fail<'VALIDATION'>).parameters.toEqualTypeOf<['VALIDATION', { field: string; message: string }]>()
        // fail("NOT_FOUND") should NOT require data (number shorthand = no data schema)
        expectTypeOf(fail<'NOT_FOUND'>).parameters.toEqualTypeOf<['NOT_FOUND', ...([data?: unknown] | [])]>()
        return true
      },
    })
  })
})

// ── Guard + input together ──────────────────────────

describe('guard + input combined', () => {
  it('both context and input are typed in the same procedure', () => {
    const auth = k.guard(() => ({ userId: 123 }))
    const schema = z.object({ title: z.string() })

    k.mutation({
      use: [auth],
      input: schema,
      resolve: ({ ctx, input }) => {
        expectTypeOf(ctx.userId).toEqualTypeOf<number>()
        expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
        expectTypeOf(input).toEqualTypeOf<{ title: string }>()
        return { created: true }
      },
    })
  })
})

// ── Wrap doesn't affect context type ────────────────

describe('wrap middleware', () => {
  it('wrap in use[] does not change context type', () => {
    const auth = k.guard(() => ({ user: { id: 1 } }))
    const timing = k.wrap(async (_ctx, next) => next())

    k.query({
      use: [auth, timing],
      resolve: ({ ctx }) => {
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: number }>()
        expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
        return true
      },
    })
  })
})

// ── Guard receives base context ─────────────────────

describe('guard context parameter', () => {
  it('guard fn receives the base context type', () => {
    k.guard((ctx) => {
      expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
      expectTypeOf(ctx.db.users).toEqualTypeOf<{ id: number; name: string }[]>()
      return { extra: true }
    })
  })
})

// ── InferClient from router ─────────────────────────

describe('InferClient', () => {
  const userSchema = z.object({ name: z.string(), age: z.number() })

  it('flat router — procedure becomes typed function', () => {
    const getUser = k.query(userSchema, ({ input }) => ({
      id: 1,
      name: input.name,
    }))

    type Client = InferClient<typeof getUser>
    expectTypeOf<Client>().toEqualTypeOf<
      (input: { name: string; age: number }) => Promise<{ id: number; name: string }>
    >()
  })

  it('no-input procedure — function takes no args', () => {
    const listAll = k.query(() => [{ id: 1 }])

    type Client = InferClient<typeof listAll>
    expectTypeOf<Client>().toEqualTypeOf<() => Promise<{ id: number }[]>>()
  })

  it('nested router — produces nested client type', () => {
    const router = k.router({
      users: {
        list: k.query(() => [{ id: 1, name: 'Alice' }]),
        create: k.mutation(z.object({ name: z.string() }), ({ input }) => ({ id: 2, name: input.name })),
      },
      health: k.query(() => ({ ok: true })),
    })

    type Client = InferClient<typeof router>
    expectTypeOf<Client>().toMatchTypeOf<{
      users: {
        list: () => Promise<{ id: number; name: string }[]>
        create: (input: { name: string }) => Promise<{ id: number; name: string }>
      }
      health: () => Promise<{ ok: boolean }>
    }>()
  })
})
