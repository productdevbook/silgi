/**
 * Shared Silgi router — used by the Nitro catch-all route.
 */
import { silgi, SilgiError } from 'silgi'
import { z } from 'zod'

// ── In-memory DB ─────────────────────────────────────

export const db = {
  users: [
    { id: 1, name: 'Alice', email: 'alice@silgi.dev' },
    { id: 2, name: 'Bob', email: 'bob@silgi.dev' },
    { id: 3, name: 'Charlie', email: 'charlie@silgi.dev' },
  ],
  nextId: 4,
}

// ── Silgi Instance ──────────────────────────────────

const k = silgi({
  context: () => ({ db }),
})

const { query, mutation, guard, router } = k

// ── Middleware ────────────────────────────────────────

const auth = guard((ctx) => {
  const token = (ctx as any).token as string | undefined
  if (token !== 'secret-token') {
    throw new SilgiError('UNAUTHORIZED', { message: 'Invalid token' })
  }
  return { userId: 1 }
})

// ── Procedures ───────────────────────────────────────

const health = query(() => ({
  status: 'ok',
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
}))

const listUsers = query(z.object({ limit: z.number().min(1).max(100).optional() }), ({ input, ctx }) => ({
  users: ctx.db.users.slice(0, input.limit ?? 10),
  total: ctx.db.users.length,
}))

const getUser = query(z.object({ id: z.number() }), ({ input, ctx }) => {
  const user = ctx.db.users.find((u) => u.id === input.id)
  if (!user) throw new SilgiError('NOT_FOUND', { message: `User #${input.id} not found` })
  return user
})

const createUser = mutation({
  use: [auth],
  input: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  errors: { CONFLICT: 409 },
  resolve: ({ input, ctx, fail }) => {
    if (ctx.db.users.some((u) => u.email === input.email)) fail('CONFLICT')
    const user = { id: ctx.db.nextId++, ...input }
    ctx.db.users.push(user)
    return user
  },
})

// ── Router ───────────────────────────────────────────

export const appRouter = router({
  health,
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
  },
})

export type AppRouter = typeof appRouter
