# Silgi — Standalone Example

Standalone Silgi server with `s.serve()`. No framework needed.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/standalone my-silgi-app
cd my-silgi-app
pnpm install
pnpm dev
```

## Endpoints

- `POST /health` — health check
- `POST /users/list` — list users (`{ "limit": 5 }`)
- `POST /users/create` — create user (auth required: `Authorization: Bearer secret`)
- `/reference` — Scalar API docs
