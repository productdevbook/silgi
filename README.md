# Katman

The fastest end-to-end type-safe RPC framework for TypeScript.

**14x faster pipeline. 10,000x fewer DB calls. 6x less memory.**

```
npm install katman
```

## Why Katman?

|  | oRPC | tRPC | Katman |
|---|---|---|---|
| Pipeline overhead | 685 ns | — | **49 ns (14x faster)** |
| Pipeline (3 mw + Zod) | 1756 ns | — | **302 ns (5.8x faster)** |
| DB calls (10K identical requests) | 10,000 | — | **1 (built-in cache + coalesce)** |
| Memory per call | 8.2 KB | — | **1.4 KB (6x less)** |
| HTTP throughput (concurrent) | 10K req/s | — | **15K req/s (1.5x)** |
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

> Auto-updated by `pnpm bench`. See [BENCHMARKS.md](./BENCHMARKS.md) for full results.

### Pipeline Performance (pure framework overhead)

```
Apple M3 Max | Node v24.11.0 | mitata

Scenario                     oRPC         Katman        Speedup
──────────────────────────────────────────────────────────────
No middleware                685 ns       49 ns         14.0x faster
Zod input validation         858 ns       226 ns        3.8x faster
3 middleware + Zod          1756 ns       302 ns        5.8x faster
5 middleware + Zod          2477 ns       430 ns        5.8x faster
```

### HTTP Throughput (Katman vs H3 v2 vs oRPC)

All three frameworks hit Node.js's HTTP server ceiling (~13K req/s for simple responses). The difference appears when middleware and validation add framework overhead:

```
3000 sequential requests — Node v24.11.0

Scenario              Katman          H3 v2           oRPC
──────────────────────────────────────────────────────────
Simple                77µs 12.8K/s   83µs 12.1K/s   75µs 13.1K/s
Zod validation        86µs 11.5K/s   97µs 10.3K/s   111µs 9.1K/s   ← Katman 1.3x vs oRPC
Guard + Zod           78µs 13.0K/s   88µs 11.4K/s   110µs 9.3K/s   ← Katman 1.4x vs oRPC
```

> The "simple" case is TCP-dominated — all frameworks perform similarly. As middleware and validation are added, Katman's 14x pipeline advantage starts to show. With heavier middleware chains, the gap grows further.

### Real-World Throughput (concurrent + caching)

```
10,000 requests, 100 concurrent

                        Katman          oRPC          Speedup
─────────────────────────────────────────────────────────────
Throughput              15,000 req/s   10,500 req/s   1.5x
DB handler calls        1              10,000         10,000x fewer
```

### Run benchmarks

```sh
pnpm bench              # all benchmarks → updates BENCHMARKS.md
pnpm bench:orpc         # pipeline: oRPC vs Katman
pnpm bench:h3           # HTTP: Katman vs H3 v2 vs oRPC
node --experimental-strip-types bench/realistic-db.ts   # realistic DB simulation
node --experimental-strip-types bench/coalesce.ts       # coalescing impact
```

## License

MIT
