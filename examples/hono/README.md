# Katman + Hono

Katman RPC mounted on a Hono server.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/hono my-hono-app
cd my-hono-app
pnpm install
pnpm dev
```

## Endpoints

- `GET /` — info
- `POST /rpc/health` — health check
- `POST /rpc/echo` — echo (`{ "msg": "hello" }`)
