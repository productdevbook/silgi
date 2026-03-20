/**
 * Silgi Playground — Full Feature Showcase
 *
 * Run: pnpm play
 *
 * Demonstrates every Silgi feature:
 *  1.  silgi() instance + context
 *  2.  guard middleware (auth)
 *  3.  wrap middleware (timing)
 *  4.  lifecycleWrap (onStart/onSuccess/onError/onFinish)
 *  5.  Short-form query / mutation
 *  6.  Config-form with errors + fail()
 *  7.  Subscription (SSE streaming)
 *  8.  Lifecycle hooks (request/response/error)
 *  9.  CORS plugin
 *  10. Rate limiting plugin
 *  11. PubSub plugin (subscription with pub/sub)
 *  12. Cookies (parse/set)
 *  13. Signing & encryption
 *  14. Body limit guard
 *  15. Coercion guard
 *  16. Custom serializer (Date, Set, Map)
 *  17. Callable (direct invocation without HTTP)
 *  18. Contract-first workflow
 *  19. Scalar / OpenAPI
 *  20. mapInput middleware
 */

import { silgi, SilgiError, callable, lifecycleWrap, mapInput, lazy } from 'silgi'
import { contract, implement } from 'silgi/contract'
import {
  cors,
  rateLimitGuard,
  MemoryRateLimiter,
  bodyLimitGuard,
  coerceGuard,
  createPublisher,
  MemoryPubSub,
  getCookie,
  setCookie,
  sign,
  unsign,
  encrypt,
  decrypt,
  createSerializer,
  createBatchHandler,
} from 'silgi/plugins'
import { z } from 'zod'

// ── Schemas ──────────────────────────────────────────

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']).default('user'),
  createdAt: z.string(),
})

const PostSchema = z.object({
  id: z.number(),
  title: z.string(),
  body: z.string(),
  authorId: z.number(),
  published: z.boolean(),
})

// ── In-memory DB ─────────────────────────────────────

const db = {
  users: [
    { id: 1, name: 'Alice', email: 'alice@silgi.dev', role: 'admin' as const, createdAt: new Date().toISOString() },
    { id: 2, name: 'Bob', email: 'bob@silgi.dev', role: 'user' as const, createdAt: new Date().toISOString() },
    { id: 3, name: 'Charlie', email: 'charlie@silgi.dev', role: 'user' as const, createdAt: new Date().toISOString() },
  ],
  posts: [
    { id: 1, title: 'Hello Silgi', body: 'First post about RPC', authorId: 1, published: true },
    { id: 2, title: 'Type Safety', body: 'End-to-end types', authorId: 1, published: true },
    { id: 3, title: 'Draft Post', body: 'Work in progress', authorId: 2, published: false },
  ],
  nextUserId: 4,
  nextPostId: 4,
}

// ── PubSub ───────────────────────────────────────────

const pubsub = createPublisher(new MemoryPubSub())

// ── Custom Serializer ────────────────────────────────

const serializer = createSerializer()
  .register<Date>('Date', {
    test: (v) => v instanceof Date,
    serialize: (v) => v.toISOString(),
    deserialize: (v) => new Date(v as string),
  })
  .register<Set<unknown>>('Set', {
    test: (v) => v instanceof Set,
    serialize: (v) => [...v],
    deserialize: (v) => new Set(v as unknown[]),
  })
  .register<Map<string, unknown>>('Map', {
    test: (v) => v instanceof Map,
    serialize: (v) => Object.fromEntries(v),
    deserialize: (v) => new Map(Object.entries(v as object)),
  })

// ── Silgi Instance ──────────────────────────────────

const s = silgi({
  context: (req: Request) => ({
    headers: Object.fromEntries(req.headers) as Record<string, string>,
    db,
    pubsub,
    requestId: crypto.randomUUID().slice(0, 8),
  }),
  hooks: {
    request: ({ path, input }) => {
      console.log(`  → ${path}`, input !== undefined ? JSON.stringify(input).slice(0, 60) : '')
    },
    response: ({ path, durationMs }) => {
      console.log(`  ← ${path} (${durationMs.toFixed(1)}ms)`)
    },
    error: ({ path, error }) => {
      const msg = error instanceof SilgiError ? `${error.code} (${error.status})` : String(error)
      console.log(`  ✗ ${path} — ${msg}`)
    },
  },
})

const { query, mutation, subscription, guard, wrap, router } = s

// ── CORS (hook-based) ────────────────────────────────

const corsHooks = cors({
  origin: 'http://localhost:3456',
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
})

// ── Guards ───────────────────────────────────────────

// 1. Auth guard
const auth = guard(async (ctx) => {
  const token = ctx.headers.authorization?.replace('Bearer ', '')
  if (token !== 'secret-token') {
    throw new SilgiError('UNAUTHORIZED', { status: 401, message: 'Invalid or missing token' })
  }
  return { userId: 1, role: 'admin' as const }
})

// 2. Rate limiting guard
const rateLimit = rateLimitGuard({
  limiter: new MemoryRateLimiter({ limit: 100, windowMs: 60_000 }),
  keyFn: (ctx: any) => ctx.headers['x-forwarded-for'] ?? 'anonymous',
})

// 3. Body limit guard (1MB)
const bodyLimit = bodyLimitGuard({ maxBytes: 1_048_576 })

// ── Wraps ────────────────────────────────────────────

// 1. Simple timing wrap
const timing = wrap(async (ctx, next) => {
  const t0 = performance.now()
  const result = await next()
  const ms = (performance.now() - t0).toFixed(1)
  console.log(`    [timing] ${ms}ms`)
  return result
})

// 2. Lifecycle wrap (structured hooks)
const lifecycle = lifecycleWrap({
  onStart: ({ ctx }) => {
    console.log(`    [lifecycle] start reqId=${(ctx as any).requestId}`)
  },
  onSuccess: ({ durationMs }) => {
    console.log(`    [lifecycle] success ${durationMs.toFixed(1)}ms`)
  },
  onError: ({ error }) => {
    console.log(`    [lifecycle] error: ${error instanceof Error ? error.message : error}`)
  },
  onFinish: () => {
    console.log(`    [lifecycle] finish`)
  },
})

// ── Procedures ───────────────────────────────────────

// --- Health (zero-config short form) ---
const health = query(async () => ({
  status: 'ok' as const,
  uptime: process.uptime(),
  timestamp: new Date().toISOString(),
  features: [
    'guard',
    'wrap',
    'lifecycle',
    'subscription',
    'hooks',
    'cors',
    'ratelimit',
    'pubsub',
    'cookies',
    'signing',
    'body-limit',
    'coerce',
    'serializer',
    'callable',
    'contract',
    'openapi',
    'batch',
    'mapInput',
  ],
}))

// --- Users: List (short form with input) ---
const listUsers = query(z.object({ limit: z.number().min(1).max(100).optional() }), async ({ input, ctx }) => {
  const limit = input.limit ?? 10
  return { users: ctx.db.users.slice(0, limit), total: ctx.db.users.length }
})

// --- Users: Get (with NOT_FOUND error) ---
const getUser = query(z.object({ id: z.number() }), async ({ input, ctx }) => {
  const user = ctx.db.users.find((u) => u.id === input.id)
  if (!user) throw new SilgiError('NOT_FOUND', { status: 404, message: `User #${input.id} not found` })
  return user
})

// --- Users: Create (builder: auth + timing + lifecycle + output + errors) ---
const createUser = mutation()
  .$use(auth, timing, lifecycle)
  .$input(
    z.object({
      name: z.string().min(1).max(100),
      email: z.string().email(),
      role: z.enum(['user', 'admin']).optional(),
    }),
  )
  .$output(UserSchema)
  .$errors({
    CONFLICT: 409,
    VALIDATION: { status: 422, message: 'Validation failed' },
  })
  .$resolve(async ({ input, ctx, fail }) => {
    if (ctx.db.users.some((u) => u.email === input.email)) {
      fail('CONFLICT')
    }
    const user = {
      id: ctx.db.nextUserId++,
      name: input.name,
      email: input.email,
      role: input.role ?? ('user' as const),
      createdAt: new Date().toISOString(),
    }
    ctx.db.users.push(user)
    await ctx.pubsub.publish('user:created', user)
    return user
  })

// --- Users: Delete (builder: auth + typed error) ---
const deleteUser = mutation()
  .$use(auth)
  .$input(z.object({ id: z.number() }))
  .$errors({ NOT_FOUND: 404 })
  .$resolve(async ({ input, ctx, fail }) => {
    const idx = ctx.db.users.findIndex((u) => u.id === input.id)
    if (idx === -1) fail('NOT_FOUND')
    const [deleted] = ctx.db.users.splice(idx, 1)
    await ctx.pubsub.publish('user:deleted', deleted)
    return { deleted: true, id: input.id }
  })

// --- Posts: List (builder: coercion guard) ---
const listPosts = query()
  .$use(coerceGuard)
  .$input(
    z.object({
      authorId: z.number().optional(),
      published: z.boolean().optional(),
    }),
  )
  .$resolve(async ({ input, ctx }) => {
    let posts = ctx.db.posts
    if (input.authorId) posts = posts.filter((p) => p.authorId === input.authorId)
    if (input.published !== undefined) posts = posts.filter((p) => p.published === input.published)
    return { posts, total: posts.length }
  })

// --- Posts: Create (builder: auth + lifecycle + output) ---
const createPost = mutation()
  .$use(auth, lifecycle)
  .$input(
    z.object({
      title: z.string().min(1).max(200),
      body: z.string().min(1),
      published: z.boolean().default(false),
    }),
  )
  .$output(PostSchema)
  .$resolve(async ({ input, ctx }) => {
    const post = {
      id: ctx.db.nextPostId++,
      title: input.title,
      body: input.body,
      authorId: ctx.userId,
      published: input.published,
    }
    ctx.db.posts.push(post)
    if (post.published) await ctx.pubsub.publish('post:published', post)
    return post
  })

// --- Cookies: Demo ---
const cookieDemo = query(async ({ ctx }) => {
  const existing = getCookie(ctx.headers.cookie ?? '', 'session')
  const newCookie = setCookie('session', 'silgi-session-123', {
    httpOnly: true,
    maxAge: 3600,
    path: '/',
    sameSite: 'strict',
  })
  return {
    existingCookie: existing ?? null,
    setCookieHeader: newCookie,
  }
})

// --- Signing & Encryption: Demo ---
const signingDemo = query(async () => {
  const secret = 'silgi-secret-key-2026'
  const message = 'hello from silgi'

  // Sign
  const signed = await sign(message, secret)
  const verified = await unsign(signed, secret)
  const tampered = await unsign(signed + 'x', secret)

  // Encrypt
  const encrypted = await encrypt(message, secret)
  const decrypted = await decrypt(encrypted, secret)

  return {
    original: message,
    signed,
    verified,
    tamperedResult: tampered, // null
    encrypted: encrypted.slice(0, 40) + '...',
    decrypted,
  }
})

// --- Custom Serializer: Demo ---
const serializerDemo = query(async () => {
  const data = {
    date: new Date('2026-01-01T00:00:00Z'),
    set: new Set([1, 2, 3]),
    map: new Map([
      ['a', 1],
      ['b', 2],
    ]),
    nested: { created: new Date() },
  }
  const serialized = serializer.stringify(data)
  const deserialized = serializer.parse(serialized)
  return {
    original: {
      date: data.date.toISOString(),
      set: [...data.set],
      map: Object.fromEntries(data.map),
    },
    serialized,
    roundTrip: deserialized,
  }
})

// --- Subscription: Tick stream ---
const tickStream = subscription(async function* () {
  for (let i = 0; i < 5; i++) {
    await new Promise((r) => setTimeout(r, 300))
    yield {
      tick: i + 1,
      users: db.users.length,
      posts: db.posts.length,
      time: new Date().toISOString(),
    }
  }
})

// --- Subscription: PubSub-based user events ---
const userEvents = subscription(async function* ({ ctx }) {
  yield* ctx.pubsub.subscribe<{ id: number; name: string; email: string }>('user:created')
})

// --- mapInput demo ---
const getUserBySlug = query({
  use: [
    mapInput((input: { slug: string }) => ({
      name: input.slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
    })),
  ],
  resolve: async ({ input, ctx }) => {
    const name = (input as any).name ?? (input as any).slug
    const user = ctx.db.users.find((u) => u.name.toLowerCase() === name?.toLowerCase())
    if (!user) throw new SilgiError('NOT_FOUND', { status: 404, message: `User "${name}" not found` })
    return user
  },
})

// ── Contract-first: Admin API ────────────────────────

const adminContract = contract({
  stats: {
    type: 'query' as const,
    output: z.object({
      totalUsers: z.number(),
      totalPosts: z.number(),
      publishedPosts: z.number(),
    }),
  },
  resetDb: {
    type: 'mutation' as const,
    input: z.object({ confirm: z.boolean() }),
    errors: { FORBIDDEN: 403 },
  },
})

const adminRouter = implement(adminContract, {
  stats: async ({ ctx }) => ({
    totalUsers: (ctx as any).db.users.length,
    totalPosts: (ctx as any).db.posts.length,
    publishedPosts: (ctx as any).db.posts.filter((p: any) => p.published).length,
  }),
  resetDb: async ({ input, fail }) => {
    if (!input.confirm) (fail as any)('FORBIDDEN')
    db.users.length = 3
    db.posts.length = 3
    db.nextUserId = 4
    db.nextPostId = 4
    return { reset: true }
  },
})

// ── Callable: Direct invocation (no HTTP) ────────────

const directListUsers = callable(listUsers, {
  context: () => ({ headers: {}, db, pubsub, requestId: 'direct' }),
})

// Test callable immediately at startup
directListUsers({ limit: 2 }).then((result) => {
  console.log(`\n[callable] Direct call result: ${JSON.stringify(result)}`)
})

// ── Router ───────────────────────────────────────────

const appRouter = router({
  health,
  users: {
    list: listUsers,
    get: getUser,
    create: createUser,
    delete: deleteUser,
    bySlug: getUserBySlug,
  },
  posts: {
    list: listPosts,
    create: createPost,
  },
  demo: {
    cookies: cookieDemo,
    signing: signingDemo,
    serializer: serializerDemo,
  },
  stream: {
    ticks: tickStream,
    userEvents,
  },
  admin: adminRouter,
})

export type AppRouter = typeof appRouter

// ── Batch Handler ────────────────────────────────────

const batchHandler = createBatchHandler(appRouter, {
  context: (req: Request) => ({
    headers: Object.fromEntries(req.headers) as Record<string, string>,
    db,
    pubsub,
    requestId: crypto.randomUUID().slice(0, 8),
  }),
  maxBatchSize: 20,
})

// ── Serve ────────────────────────────────────────────

s.serve(appRouter, {
  port: Number(process.env.PORT) || 3456,
  scalar: {
    title: 'Silgi Playground',
    version: '0.1.0',
    description: 'Full feature showcase — every Silgi capability in one server',
    security: { type: 'http', scheme: 'bearer', bearerFormat: 'Token' },
  },
})

console.log('\n╔══════════════════════════════════════════════╗')
console.log('║        Silgi Playground — All Features      ║')
console.log('╠══════════════════════════════════════════════╣')
console.log('║                                              ║')
console.log('║  QUERIES (GET)                               ║')
console.log('║    /health              Health check          ║')
console.log('║    /users/list          List users            ║')
console.log('║    /users/get           Get user by id        ║')
console.log('║    /users/bySlug        Get user by slug      ║')
console.log('║    /posts/list          List posts            ║')
console.log('║    /demo/cookies        Cookie demo           ║')
console.log('║    /demo/signing        Sign/encrypt demo     ║')
console.log('║    /demo/serializer     Custom serializer     ║')
console.log('║    /admin/stats         Admin stats           ║')
console.log('║                                              ║')
console.log('║  MUTATIONS (POST, auth: Bearer secret-token) ║')
console.log('║    /users/create        Create user           ║')
console.log('║    /users/delete        Delete user           ║')
console.log('║    /posts/create        Create post           ║')
console.log('║    /admin/resetDb       Reset database        ║')
console.log('║                                              ║')
console.log('║  SUBSCRIPTIONS (SSE)                         ║')
console.log('║    /stream/ticks        5-tick stream         ║')
console.log('║    /stream/userEvents   PubSub user events    ║')
console.log('║                                              ║')
console.log('║  SPECIAL                                     ║')
console.log('║    /reference           Scalar API docs       ║')
console.log('║    /openapi.json        OpenAPI 3.1 spec      ║')
console.log('║                                              ║')
console.log('║  Auth: Bearer secret-token                   ║')
console.log('╚══════════════════════════════════════════════╝\n')
