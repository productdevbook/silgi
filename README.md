# Katman

The fastest end-to-end type-safe RPC framework for TypeScript.

**5x faster than oRPC. 6x less memory. Single package.**

```
npm install katman
```

## Why Katman?

|  | oRPC | tRPC | Katman |
|---|---|---|---|
| Pipeline (3 middleware + Zod) | 1800 ns | — | **353 ns** |
| Memory per call | 13.5 KB | — | **2.3 KB** |
| API style | Chain builder | Chain builder | **Single object** |
| query/mutation distinction | No | Yes | **Yes** |
| Middleware model | All onion | All onion | **guard (flat) + wrap (onion)** |
| Package count | 37 packages | 10+ packages | **1 package** |
| OpenAPI generation | Yes | Plugin | **Yes** |
| SSE/Streaming | Yes | Yes | **Yes** |

## Quick Start

```ts
import { katman, KatmanError } from "katman"
import { z } from "zod"

const k = katman({
  context: (req) => ({
    db: getDB(),
    headers: Object.fromEntries(req.headers),
  }),
})

const { query, mutation, subscription, guard, wrap, router, handler } = k
```

### Define middleware

```ts
// Guard — flat execution, zero closures, sync fast-path
const auth = guard(async (ctx) => {
  const user = await verify(ctx.headers.authorization)
  if (!user) throw new KatmanError("UNAUTHORIZED")
  return { user } // merged into context
})

// Wrap — onion model, for before/after logic
const timing = wrap(async (ctx, next) => {
  const t0 = performance.now()
  const result = await next()
  console.log(`${(performance.now() - t0).toFixed(1)}ms`)
  return result
})
```

### Define procedures

```ts
// Short form — schema + function
const listUsers = query(
  z.object({ limit: z.number().optional() }),
  async ({ input, ctx }) => ctx.db.users.findMany({ take: input.limit }),
)

// Config form — middleware, errors, validation
const createUser = mutation({
  use: [auth, timing],
  input: z.object({ name: z.string(), email: z.string().email() }),
  output: UserSchema,
  errors: { CONFLICT: 409 },
  resolve: async ({ input, ctx, fail }) => {
    if (await ctx.db.users.findByEmail(input.email)) fail("CONFLICT")
    return ctx.db.users.create({ ...input, by: ctx.user.id })
  },
})

// SSE streaming
const live = subscription(async function* ({ ctx }) {
  for await (const event of ctx.db.changes()) yield event
})
```

### Serve

```ts
const appRouter = router({
  users: { list: listUsers, create: createUser },
  live,
})

// Node.js
k.serve(appRouter, { port: 3000 })

// Cloudflare Workers / Deno / Bun
export default { fetch: handler(appRouter) }
```

## How It's Fast

### 1. Guard/Wrap Split

Most middleware (auth, rate limit, permissions) only enriches context — it doesn't need before/after logic. Katman separates these as **guards** (flat, zero closures) from **wraps** (onion model):

```
Traditional (oRPC/tRPC):     Katman:
mw1 → mw2 → mw3 → handler   guard1 → guard2 → guard3 (flat, 0 closures)
  ↑      ↑      ↑                                    ↓
  └──────┴──────┘             wrap1(handler)          (1 closure)
  3 closures + 6 async hops   0 closures + 2 async hops
```

### 2. Unrolled Guard Execution

Guards are specialized for 0-4 count — no loop overhead. V8's Maglev compiler inlines each guard call:

```ts
// 3 guards → direct calls, no loop
runGuards3(ctx, authGuard, rateLimitGuard, permGuard)
```

### 3. Flat Map Router

Routes compile to a `Map<string, Handler>` at startup. Request-time lookup is O(1):

```ts
// oRPC: traverse router tree per request — O(depth)
// Katman: map.get("users/list") — O(1)
```

### 4. Context Pool

Pre-allocated context objects are borrowed and returned per request — zero GC pressure.

### 5. Zero URL Parsing

Pathname extracted via string manipulation (5ns) instead of `new URL()` (198ns) — 40x faster.

## Ecosystem

All from a single `npm install katman`:

| Import | What |
|---|---|
| `katman` | Core API — katman, KatmanError, types |
| `katman/node` | Node.js HTTP adapter |
| `katman/fetch` | Fetch API adapter (Workers, Deno, Bun) |
| `katman/fastify` | Fastify adapter |
| `katman/websocket` | WebSocket handler |
| `katman/plugins` | CORS, CSRF, Batch plugins |
| `katman/openapi` | OpenAPI 3.1.1 spec generation |
| `katman/zod` | Zod → JSON Schema converter |
| `katman/tanstack-query` | TanStack Query integration |
| `katman/react` | React Server Actions |
| `katman/otel` | OpenTelemetry tracing |
| `katman/pino` | Pino structured logging |
| `katman/ratelimit` | Rate limiting middleware |
| `katman/client` | Type-safe RPC client |
| `katman/client/fetch` | Fetch transport |
| `katman/client/plugins` | Retry, Batch, Dedupe, CSRF |

## Benchmarks

```
Apple M3 Max | Node 24.11.0

oRPC vs Katman — Pipeline Performance (mitata)

Scenario                     oRPC         Katman        Diff
─────────────────────────────────────────────────────────
No middleware                638 ns       166 ns       3.8x faster
Zod input validation         807 ns       250 ns       3.2x faster
3 middleware + Zod          1800 ns       353 ns       5.1x faster
5 middleware + Zod          2390 ns       448 ns       5.3x faster
I/O Zod validation          1050 ns       417 ns       2.5x faster

Memory per call (3 mw + Zod):
oRPC:   13.69 KB
Katman:  2.33 KB → 5.9x less
```

Run benchmarks yourself:

```sh
pnpm bench          # oRPC vs Katman
pnpm bench:pipeline # v1 vs v2 internal
pnpm bench:micro    # bottleneck analysis
```

## License

MIT
