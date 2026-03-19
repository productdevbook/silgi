# Katman — Standalone Example

Standalone Katman server with `k.serve()`. No framework needed.

## Quick Start

```bash
npx giget@latest gh:productdevbook/katman/examples/standalone my-katman-app
cd my-katman-app
pnpm install
pnpm dev
```

## Endpoints

- `POST /health` — health check
- `POST /users/list` — list users (`{ "limit": 5 }`)
- `POST /users/create` — create user (auth required: `Authorization: Bearer secret`)
- `/reference` — Scalar API docs
