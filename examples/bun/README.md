# Silgi + Bun

Silgi RPC running on Bun's native HTTP server with `Bun.serve()` and `s.handler()`.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/bun my-bun-app
cd my-bun-app
bun install
bun dev
```

## Endpoints

- `GET /` — info
- `GET /todos/list` — list todos
- `POST /todos/create` — create todo (`{ "title": "My task" }`)
- `POST /todos/toggle` — toggle todo (`{ "id": 1 }`)
- `POST /todos/remove` — remove todo (`{ "id": 1 }`)
- `/reference` — Scalar API docs
