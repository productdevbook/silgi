# Katman + SvelteKit

Katman RPC integrated with SvelteKit via the `katmanSvelteKit` adapter.

Demonstrates a catch-all API route at `src/routes/api/rpc/[...path]/+server.ts` and a Svelte page that calls the endpoints.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/sveltekit my-sveltekit-app
cd my-sveltekit-app
pnpm install
pnpm dev
```

## Endpoints

- `POST /api/rpc/health` -- health check
- `POST /api/rpc/echo` -- echo (`{ "msg": "hello" }`)
- `POST /api/rpc/greet` -- greet (`{ "name": "World" }`)
