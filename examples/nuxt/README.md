# Katman + Nuxt

Katman RPC integrated with Nuxt 5 via the `katmanNitro` adapter on a catch-all server route.

Demonstrates a Nitro catch-all route at `server/routes/rpc/[...path].ts` and a Vue page that calls the endpoints.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/nuxt my-nuxt-app
cd my-nuxt-app
pnpm install
pnpm dev
```

## Endpoints

- `POST /rpc/health` -- health check
- `POST /rpc/echo` -- echo (`{ "msg": "hello" }`)
- `POST /rpc/greet` -- greet (`{ "name": "World" }`)
