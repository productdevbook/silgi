# Silgi + Elysia

Silgi RPC mounted as an Elysia plugin with `silgiElysia`. Runs on Bun.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/elysia my-elysia-app
cd my-elysia-app
pnpm install
pnpm dev
```

## Endpoints

- `GET /` -- info
- `POST /rpc/health` -- health check
- `POST /rpc/echo` -- echo (`{ "msg": "hello" }`)
- `POST /rpc/greet` -- greet (`{ "name": "World" }`)
