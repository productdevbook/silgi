# Silgi + Nuxt

Full-featured demo with Silgi RPC and Nuxt 5.

## Pages

- `/` — Home (page list)
- `/todos` — CRUD todo list with typed Silgi client
- `/auth` — Login/logout with auth guard
- `/errors` — Error handling demo (NOT_FOUND, validation, unauthorized)
- `/broker` — RPC to a remote worker service via NATS
- `/json` — JSON protocol
- `/msgpack` — MessagePack binary protocol
- `/devalue` — devalue rich type protocol
- `/reference` — Scalar API docs

## Structure

```
server.ts                         — Entry: exports { fetch } with scalar
server/rpc/
  instance.ts                     — silgi() instance
  router.ts                       — Root router
  guards.ts                       — Auth guard
  auth/
    index.ts                      — login, logout, me
    schema.ts                     — Users, sessions, tokens
  todos/
    index.ts                      — list, create, toggle, remove
    schema.ts                     — Zod schemas + store
  broker/
    index.ts                      — Worker router definition
    worker.ts                     — Standalone worker process (NATS)
    client.ts                     — NATS client used by Nuxt server
app/
  app.vue                         — NuxtPage
  composables/useClient.ts        — Silgi typed client
  pages/                          — Vue pages
```

## Quick Start

```bash
pnpm install
pnpm dev
```

## Broker Demo (NATS)

The `/broker` page calls a separate worker service via NATS. To run it:

```bash
# 1. Start NATS
docker compose up -d

# 2. Start the worker (separate terminal)
npx tsx server/rpc/broker/worker.ts

# 3. Start Nuxt
pnpm dev
```

Open http://localhost:3000/broker and try Ping, Uppercase, Fibonacci.
