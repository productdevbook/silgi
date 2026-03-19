# Katman + Next.js

Katman RPC integrated with Next.js App Router via `katmanNextjs` adapter.

Demonstrates a catch-all API route at `app/api/rpc/[...path]/route.ts` that handles all RPC calls, and a client page that calls the endpoints.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/nextjs my-nextjs-app
cd my-nextjs-app
pnpm install
pnpm dev
```

## Endpoints

- `POST /api/rpc/health` -- health check
- `POST /api/rpc/echo` -- echo (`{ "msg": "hello" }`)
- `POST /api/rpc/greet` -- greet (`{ "name": "World" }`)
