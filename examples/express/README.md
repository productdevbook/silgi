# Katman + Express

Katman RPC mounted as Express middleware with `katmanExpress`.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/express my-express-app
cd my-express-app
pnpm install
pnpm dev
```

## Endpoints

- `GET /` -- info
- `POST /rpc/health` -- health check
- `POST /rpc/echo` -- echo (`{ "msg": "hello" }`)
- `POST /rpc/greet` -- greet (`{ "name": "World" }`)
