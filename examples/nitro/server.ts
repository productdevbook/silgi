/**
 * Silgi + Nitro — direct integration (like Hono + Nitro).
 *
 * Export an object with a `fetch` method — Nitro uses it as the server.
 * No H3, no silgiH3 adapter needed — just handler().
 */
import { silgi, SilgiError } from 'silgi'
import { z } from 'zod'

// ── In-memory DB ─────────────────────────────────────

const db = {
  users: [
    { id: 1, name: 'Alice', email: 'alice@silgi.dev' },
    { id: 2, name: 'Bob', email: 'bob@silgi.dev' },
    { id: 3, name: 'Charlie', email: 'charlie@silgi.dev' },
  ],
  nextId: 4,
}

// ── Silgi Instance ──────────────────────────────────

const s = silgi({
  context: (req) => ({
    db,
    headers: Object.fromEntries(req.headers),
  }),
})

const { query, mutation, guard, router, handler } = s

// ── Middleware ────────────────────────────────────────

const auth = guard((ctx) => {
  const token = ctx.headers.authorization?.replace('Bearer ', '')
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

const appRouter = router({
  health,
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
  },
})

// Export with fetch method — Nitro detects this like Hono
const fetchHandler = handler(appRouter)
export default { fetch: fetchHandler }
