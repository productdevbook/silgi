# Katman

The fastest end-to-end type-safe RPC framework for TypeScript.

**5.7x faster** than oRPC. **18x faster** than H3. Single package.

```bash
npm install katman
```

## Quick Start

```ts
import { katman, KatmanError } from "katman"
import { z } from "zod"

const k = katman({ context: (req) => ({ db: getDB() }) })
const { query, mutation, guard, wrap, router } = k

// Guard middleware (flat, zero-closure)
const auth = guard(async (ctx) => {
  const user = await verify(ctx.headers.authorization)
  if (!user) throw new KatmanError("UNAUTHORIZED")
  return { user }
})

// Query — short form
const listUsers = query(
  z.object({ limit: z.number().optional() }),
  async ({ input, ctx }) => ctx.db.users.findMany({ take: input.limit }),
)

// Mutation — full config
const createUser = mutation({
  use: [auth],
  input: z.object({ name: z.string(), email: z.string().email() }),
  errors: { CONFLICT: 409 },
  resolve: async ({ input, ctx, fail }) => {
    if (await ctx.db.users.exists(input.email)) fail("CONFLICT")
    return ctx.db.users.create(input)
  },
})

// Router + Serve
const appRouter = router({ users: { list: listUsers, create: createUser } })

k.serve(appRouter, {
  port: 3000,
  scalar: true,       // API docs at /reference
  ws: true,           // WebSocket RPC on same port
})
```

## Benchmarks

Auto-generated on Apple M3 Max, Node.js v24.

### Pipeline (pure execution, no HTTP)

| Scenario | Katman | oRPC | H3 v2 | vs oRPC | vs H3 |
|---|---|---|---|---|---|
| No middleware | **112 ns** | 692 ns | 2161 ns | **6.2x** | **19.3x** |
| Zod validation | **260 ns** | 865 ns | 4678 ns | **3.3x** | **18.0x** |
| 3 mw + Zod | **318 ns** | 1823 ns | 4291 ns | **5.7x** | **13.5x** |
| 5 mw + Zod | **450 ns** | 2420 ns | 4427 ns | **5.4x** | **9.8x** |

### HTTP/1.1 (full TCP request/response)

| Scenario | Katman | oRPC | vs oRPC |
|---|---|---|---|
| Simple query | **86 us** | 87 us | ~tied |
| Zod validation | **103 us** | 135 us | **1.3x faster** |
| Guard + Zod | **88 us** | 131 us | **1.5x faster** |

### WebSocket (persistent connection)

| | Katman | oRPC | H3 |
|---|---|---|---|
| Latency | **44 us** | 47 us | 39 us |

### Runtime Support

| Runtime | handler() | serve() | WebSocket |
|---|---|---|---|
| **Node.js 22+** | 9 us/req | Full | Full |
| **Bun** | 2 us/req | Full | Full |
| **Deno** | Full | -- | -- |

## Features

### Core
- **Type-safe** -- Input, output, context, errors all fully typed
- **Single package** -- No `@katman/server` + `@katman/client` + `@katman/contract`
- **Standard Schema** -- Works with Zod, Valibot, ArkType
- **Guard/Wrap middleware** -- Flat guards (context enrichment) + wraps (onion lifecycle)
- **Compiled pipeline** -- Pre-linked middleware chain, unrolled guard runners

### Server
- **serve()** -- One-line Node.js server with auto port finding
- **handler()** -- Fetch API handler for any runtime (Node, Bun, Deno, Cloudflare)
- **HTTP/2** -- TLS with HTTP/1.1 fallback: `serve(router, { http2: { cert, key } })`
- **WebSocket RPC** -- Bidirectional on same port: `serve(router, { ws: true })`
- **Scalar UI** -- API docs at `/reference`: `serve(router, { scalar: true })`

### Client
- **ofetch transport** -- Retry, timeout, interceptors built-in
- **Binary protocol** -- MessagePack (30% smaller payloads): `createLink({ binary: true })`
- **Rich types** -- devalue codec for Date, Map, Set, BigInt across the wire
- **Type-safe client** -- `createClient<AppRouter>(link)` with full inference
- **Plugins** -- Retry, dedupe, batch, CSRF

### Protocols and Codecs
- **JSON** -- Default, fastest encode/decode
- **MessagePack** -- Binary, 30% smaller, Date native (no competitor has this)
- **devalue** -- Date, Map, Set, BigInt, RegExp, circular refs, undefined

### Plugins
- **Rate limiting** -- In-memory or custom backend
- **CORS** -- HTTP-level CORS headers
- **OpenTelemetry** -- Span per procedure call
- **Pino** -- Structured logging
- **Batch** -- Multiple RPC calls in one HTTP request
- **CSRF** -- Token-based protection

### Lifecycle Hooks
```ts
const k = katman({
  context: (req) => ({}),
  hooks: {
    request: ({ path, input }) => console.log(`-> ${path}`),
    response: ({ path, durationMs }) => console.log(`<- ${path} ${durationMs}ms`),
    error: ({ path, error }) => console.error(`x ${path}`, error),
  },
})

// Dynamic hooks
const unhook = k.hook("request", ({ path }) => metrics.inc(path))
unhook() // remove
```

## Client Usage

```ts
import { createClient } from "katman/client"
import { createLink } from "katman/client/ofetch"

const link = createLink({
  url: "http://localhost:3000",
  binary: true,           // MessagePack protocol
  timeout: 5000,
  retry: 2,
  retryDelay: (ctx) => Math.min(1000 * 2 ** ctx.retryCount, 10000),
  headers: () => ({ authorization: `Bearer ${getToken()}` }),
  onRequest: ({ options }) => { /* intercept */ },
})

const client = createClient<typeof appRouter>(link)

const users = await client.users.list({ limit: 10 })
const user = await client.users.create({ name: "Alice", email: "alice@test.com" })
```

## WebSocket Client

```ts
const ws = new WebSocket("ws://localhost:3000")

ws.onopen = () => {
  ws.send(JSON.stringify({ id: "1", path: "users/list", input: { limit: 10 } }))
}

ws.onmessage = (event) => {
  const { id, result, error } = JSON.parse(event.data)
  console.log(result) // [{ id: 1, name: "Alice" }, ...]
}
```

## OpenAPI / Scalar

```ts
k.serve(appRouter, {
  scalar: {
    title: "My API",
    version: "2.0.0",
    description: "Production API",
    security: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
    servers: [{ url: "https://api.example.com", description: "Production" }],
    contact: { email: "dev@example.com" },
  },
})
// -> /reference (Scalar UI)
// -> /openapi.json (OpenAPI 3.1.0 spec)
```

## Middleware

```ts
// Guard -- enriches context (flat, sync-capable)
const auth = guard(async (ctx) => {
  const token = ctx.headers.authorization?.replace("Bearer ", "")
  const user = await verifyToken(token)
  if (!user) throw new KatmanError("UNAUTHORIZED")
  return { user }  // merged into ctx
})

// Wrap -- onion lifecycle (before + after)
const timing = wrap(async (ctx, next) => {
  const start = Date.now()
  const result = await next()
  console.log(`${Date.now() - start}ms`)
  return result
})

// Use in procedure
const protectedQuery = query({
  use: [auth, timing],
  input: z.object({ id: z.number() }),
  resolve: ({ ctx, input }) => ctx.db.users.get(input.id),
})
```

## Typed Errors

```ts
const deleteUser = mutation({
  use: [auth],
  input: z.object({ id: z.number() }),
  errors: {
    NOT_FOUND: 404,
    FORBIDDEN: { status: 403, data: z.object({ reason: z.string() }) },
  },
  resolve: ({ input, ctx, fail }) => {
    const user = ctx.db.users.get(input.id)
    if (!user) fail("NOT_FOUND")
    if (user.ownerId !== ctx.user.id) fail("FORBIDDEN", { reason: "Not owner" })
    return ctx.db.users.delete(input.id)
  },
})
```

## How to Run

```bash
pnpm install
pnpm dev              # vitest watch
pnpm test             # vitest run (304 tests)
pnpm build            # obuild -> dist/
pnpm play             # playground server
pnpm bench            # full benchmark suite
pnpm typecheck        # tsgo --noEmit
```

## Tech Stack

| Tool | Purpose |
|---|---|
| [obuild](https://github.com/unjs/obuild) | Build (rolldown + oxc) |
| [ofetch](https://github.com/unjs/ofetch) | Client HTTP transport |
| [hookable](https://github.com/unjs/hookable) | Lifecycle hooks |
| [crossws](https://github.com/unjs/crossws) | WebSocket adapter |
| [defu](https://github.com/unjs/defu) | Config merge |
| [get-port-please](https://github.com/unjs/get-port-please) | Auto port finding |
| [msgpackr](https://github.com/kriszyp/msgpackr) | Binary protocol |
| [devalue](https://github.com/Rich-Harris/devalue) | Rich type serialization |
| [Scalar](https://github.com/scalar/scalar) | API Reference UI |
| [vitest](https://vitest.dev) | Testing |
| [mitata](https://github.com/evanwashere/mitata) | Benchmarking |

## License

MIT
