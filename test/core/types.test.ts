import { describe, it, expectTypeOf } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'

import type { ProcedureDef, InferClient } from '#src/types.ts'

const k = silgi({
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
    const proc = k.$input(userSchema).$resolve(({ input }) => {
      // input should be the validated (output) type of the schema
      expectTypeOf(input).toEqualTypeOf<UserOutput>()
      return { ok: true }
    })
    // ProcedureDef TInput should be the schema input type (what clients send)
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', UserInput, { ok: boolean }, {}>>()
  })

  it('short form: mutation(schema, resolve) — input is inferred', () => {
    const proc = k.$input(userSchema).$resolve(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<UserOutput>()
      return { created: true }
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', UserInput, { created: boolean }, {}>>()
  })

  it('short form: query(schema, resolve) — input is inferred (was config form)', () => {
    const proc = k.$input(userSchema).$resolve(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<UserOutput>()
      return { ok: true }
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', UserInput, { ok: boolean }, {}>>()
  })

  it('short form: mutation(schema, resolve) — input is inferred (was config form)', () => {
    const proc = k.$input(userSchema).$resolve(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<UserOutput>()
      return { ok: true }
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', UserInput, { ok: boolean }, {}>>()
  })

  it('no-input query: resolve gets undefined', () => {
    const proc = k.$resolve(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<undefined>()
      return 42
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, number, {}>>()
  })
})

// ── Context type inference ──────────────────────────

describe('context type inference', () => {
  it('base context flows into resolve', () => {
    k.$resolve(({ ctx }) => {
      expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
      expectTypeOf(ctx.db.users).toEqualTypeOf<{ id: number; name: string }[]>()
      return true
    })
  })

  it('guard enriches context', () => {
    const auth = k.guard(() => ({ user: { id: 1, role: 'admin' as const } }))

    k.$use(auth).$resolve(({ ctx }) => {
      expectTypeOf(ctx.user).toEqualTypeOf<{ id: number; role: 'admin' }>()
      expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
      return true
    })
  })

  it('multiple guards accumulate context', () => {
    const auth = k.guard(() => ({ user: { id: 1 } }))
    const org = k.guard(() => ({ orgId: 'abc' }))

    k.$use(auth)
      .$use(org)
      .$resolve(({ ctx }) => {
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: number }>()
        expectTypeOf(ctx.orgId).toEqualTypeOf<string>()
        return true
      })
  })
})

// ── Guard errors merge into procedure ────────────────

describe('guard errors', () => {
  it('guard with errors — fail() includes guard error codes', () => {
    const auth = k.guard({
      errors: { UNAUTHORIZED: 401 },
      fn: () => ({ userId: 1 }),
    })

    k.$use(auth)
      .$errors({ CONFLICT: 409 })
      .$resolve(({ fail }) => {
        // fail should accept both procedure errors AND guard errors
        expectTypeOf(fail).parameter(0).toEqualTypeOf<'CONFLICT' | 'UNAUTHORIZED'>()
        return true
      })
  })

  it('multiple guards with errors — all merge', () => {
    const auth = k.guard({
      errors: { UNAUTHORIZED: 401 },
      fn: () => ({ userId: 1 }),
    })
    const rateLimit = k.guard({
      errors: { RATE_LIMITED: 429 },
      fn: () => {},
    })

    k.$use(auth)
      .$use(rateLimit)
      .$errors({ NOT_FOUND: 404 })
      .$resolve(({ fail }) => {
        expectTypeOf(fail).parameter(0).toEqualTypeOf<'NOT_FOUND' | 'UNAUTHORIZED' | 'RATE_LIMITED'>()
        return true
      })
  })

  it('guard without errors — no change to fail()', () => {
    const simple = k.guard(() => ({ extra: true }))

    k.$use(simple)
      .$errors({ NOT_FOUND: 404 })
      .$resolve(({ fail }) => {
        expectTypeOf(fail).parameter(0).toEqualTypeOf<'NOT_FOUND'>()
        return true
      })
  })

  it('guard with errors but no procedure errors — fail() has guard errors only', () => {
    const auth = k.guard({
      errors: { UNAUTHORIZED: 401, FORBIDDEN: 403 },
      fn: () => ({ userId: 1 }),
    })

    k.$use(auth).$resolve(({ fail }) => {
      expectTypeOf(fail).parameter(0).toEqualTypeOf<'UNAUTHORIZED' | 'FORBIDDEN'>()
      return true
    })
  })
})

// ── Output schema type safety ───────────────────────

describe('output schema enforces resolve return type', () => {
  const outputSchema = z.object({ id: z.number(), name: z.string() })

  it('resolve must return output-compatible type when output is set', () => {
    const proc = k.$output(outputSchema).$resolve(() => ({ id: 1, name: 'Alice' }))
    // ProcedureDef TOutput is the schema output type, not the raw resolve return
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { id: number; name: string }, {}>>()
  })

  it('mutation output schema enforces return type', () => {
    const proc = k
      .$input(z.object({ name: z.string() }))
      .$output(outputSchema)
      .$resolve(({ input }) => ({ id: 1, name: input.name }))
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', { name: string }, { id: number; name: string }, {}>>()
  })

  it('without output schema — resolve return type is inferred freely', () => {
    const proc = k.$resolve(() => ({ custom: true, count: 42 }))
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { custom: boolean; count: number }, {}>>()
  })

  it('output with transform — resolve must match schema input type', () => {
    const schema = z.object({ id: z.number() }).transform((v) => ({ ...v, computed: true }))
    const proc = k.$output(schema).$resolve(() => ({ id: 1 })) // returns schema INPUT type (pre-transform)
    // ProcedureDef TOutput is the schema OUTPUT type (post-transform)
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { id: number; computed: boolean }, {}>>()
  })
})

// ── Builder pattern ─────────────────────────────────

describe('builder pattern', () => {
  const outputSchema = z.object({ id: z.number(), name: z.string() })

  it('query() returns builder, .$output().$resolve() produces ProcedureDef', () => {
    const proc = k.$output(outputSchema).$resolve(() => ({ id: 1, name: 'Alice' }))

    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { id: number; name: string }, {}>>()
  })

  it('mutation() builder with $input + $output + $errors', () => {
    const proc = k
      .$input(z.object({ email: z.string() }))
      .$output(outputSchema)
      .$errors({ CONFLICT: 409 as const })
      .$resolve(({ input, fail: _fail }) => {
        expectTypeOf(input).toEqualTypeOf<{ email: string }>()
        return { id: 1, name: input.email }
      })

    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', { email: string }, { id: number; name: string }>>()
  })

  it('builder without $output — $resolve return freely inferred', () => {
    const proc = k.$resolve(() => ({ custom: true, count: 42 }))

    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { custom: boolean; count: number }, {}>>()
  })
})

// ── Error / fail type inference ─────────────────────

describe('error type inference', () => {
  it('fail() is typed from errors config', () => {
    k.$errors({
      NOT_FOUND: 404,
      BAD_INPUT: { status: 400, data: z.object({ field: z.string() }) },
    }).$resolve(({ fail }) => {
      // fail should accept error codes from the errors config
      expectTypeOf(fail).parameter(0).toEqualTypeOf<'NOT_FOUND' | 'BAD_INPUT'>()
      return true
    })
  })
})

// ── Output type inference ───────────────────────────

describe('output type inference', () => {
  it('ProcedureDef TOutput is inferred from resolve return', () => {
    const proc = k.$resolve(() => ({ count: 42, items: ['a', 'b'] }))
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', undefined, { count: number; items: string[] }, {}>>()
  })
})

// ── Schema transform (input ≠ output) ───────────────

describe('schema with transform', () => {
  const dateSchema = z.string().transform((s) => new Date(s))

  it('resolve input is the transformed type, ProcedureDef TInput is the raw type', () => {
    const proc = k.$input(dateSchema).$resolve(({ input }) => {
      // After validation, input should be Date (schema output)
      expectTypeOf(input).toEqualTypeOf<Date>()
      return input.toISOString()
    })
    // Client sends string (schema input), ProcedureDef captures that
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'query', string, string, {}>>()
  })

  it('short form with transform schema (was config form)', () => {
    const proc = k.$input(dateSchema).$resolve(({ input }) => {
      expectTypeOf(input).toEqualTypeOf<Date>()
      return { saved: true }
    })
    expectTypeOf(proc).toMatchTypeOf<ProcedureDef<'mutation', string, { saved: boolean }, {}>>()
  })
})

// ── fail() data parameter ───────────────────────────

describe('fail() data parameter typing', () => {
  it('fail with data schema requires typed second arg', () => {
    k.$errors({
      VALIDATION: { status: 400, data: z.object({ field: z.string(), message: z.string() }) },
      NOT_FOUND: 404,
    }).$resolve(({ fail }) => {
      // fail("VALIDATION") should require data: { field: string, message: string }
      expectTypeOf(fail<'VALIDATION'>).parameters.toEqualTypeOf<['VALIDATION', { field: string; message: string }]>()
      // fail("NOT_FOUND") should NOT require data (number shorthand = no data schema)
      expectTypeOf(fail<'NOT_FOUND'>).parameters.toEqualTypeOf<['NOT_FOUND', ...([data?: unknown] | [])]>()
      return true
    })
  })
})

// ── Guard + input together ──────────────────────────

describe('guard + input combined', () => {
  it('both context and input are typed in the same procedure', () => {
    const auth = k.guard(() => ({ userId: 123 }))
    const schema = z.object({ title: z.string() })

    k.$use(auth)
      .$input(schema)
      .$resolve(({ ctx, input }) => {
        expectTypeOf(ctx.userId).toEqualTypeOf<number>()
        expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
        expectTypeOf(input).toEqualTypeOf<{ title: string }>()
        return { created: true }
      })
  })
})

// ── Wrap doesn't affect context type ────────────────

describe('wrap middleware', () => {
  it('wrap in use[] does not change context type', () => {
    const auth = k.guard(() => ({ user: { id: 1 } }))
    const timing = k.wrap(async (_ctx, next) => next())

    k.$use(auth)
      .$use(timing)
      .$resolve(({ ctx }) => {
        expectTypeOf(ctx.user).toEqualTypeOf<{ id: number }>()
        expectTypeOf(ctx.headers).toEqualTypeOf<Record<string, string>>()
        return true
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
    const getUser = k.$input(userSchema).$resolve(({ input }) => ({
      id: 1,
      name: input.name,
    }))

    type Client = InferClient<typeof getUser>
    expectTypeOf<Client>().toEqualTypeOf<
      (input: { name: string; age: number }) => Promise<{ id: number; name: string }>
    >()
  })

  it('no-input procedure — function takes no args', () => {
    const listAll = k.$resolve(() => [{ id: 1 }])

    type Client = InferClient<typeof listAll>
    expectTypeOf<Client>().toEqualTypeOf<() => Promise<{ id: number }[]>>()
  })

  it('nested router — produces nested client type', () => {
    const router = k.router({
      users: {
        list: k.$resolve(() => [{ id: 1, name: 'Alice' }]),
        create: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ id: 2, name: input.name })),
      },
      health: k.$resolve(() => ({ ok: true })),
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

  it('subscription — returns AsyncIterableIterator', () => {
    const stream = k.subscription(async function* () {
      yield { tick: 1, time: 'now' }
    })

    type Client = InferClient<typeof stream>
    expectTypeOf<Client>().toEqualTypeOf<() => AsyncIterableIterator<{ tick: number; time: string }>>()
  })

  it('subscription with input — takes input, returns AsyncIterableIterator', () => {
    const stream = k.subscription(z.object({ channel: z.string() }), async function* ({ input }) {
      yield { channel: input.channel, message: 'hello' }
    })

    type Client = InferClient<typeof stream>
    expectTypeOf<Client>().toEqualTypeOf<
      (input: { channel: string }) => AsyncIterableIterator<{ channel: string; message: string }>
    >()
  })

  it('router with subscriptions — NestedClient accepts mixed types', () => {
    const router = k.router({
      users: {
        list: k.$resolve(() => [{ id: 1 }]),
        create: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ id: 1, name: input.name })),
      },
      stream: {
        ticks: k.subscription(async function* () {
          yield { tick: 1 }
        }),
        messages: k.subscription(z.object({ roomId: z.string() }), async function* ({ input }) {
          yield { roomId: input.roomId, text: 'hi' }
        }),
      },
    })

    type Client = InferClient<typeof router>
    expectTypeOf<Client>().toMatchTypeOf<{
      users: {
        list: () => Promise<{ id: number }[]>
        create: (input: { name: string }) => Promise<{ id: number; name: string }>
      }
      stream: {
        ticks: () => AsyncIterableIterator<{ tick: number }>
        messages: (input: { roomId: string }) => AsyncIterableIterator<{ roomId: string; text: string }>
      }
    }>()
  })
})
