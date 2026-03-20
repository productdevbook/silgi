# Silgi + Nuxt — Todo App

A todo app built with Silgi RPC and Nuxt 5 via the `silgiH3` adapter.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/nuxt my-nuxt-app
cd my-nuxt-app
pnpm install
pnpm dev
```

## Endpoints

- `GET /rpc/todos/list` — list all todos
- `POST /rpc/todos/create` — create a todo (`{ "title": "..." }`)
- `POST /rpc/todos/toggle` — toggle completed (`{ "id": 1 }`)
- `POST /rpc/todos/remove` — delete a todo (`{ "id": 1 }`)

## Structure

```
server/
  rpc.ts                    — Silgi procedures + router
  routes/rpc/[...path].ts   — Nitro catch-all route
app.vue                     — Vue todo UI
```
