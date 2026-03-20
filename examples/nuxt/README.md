# Silgi + Nuxt — Todo App

A todo app built with Silgi RPC and Nuxt 5 via the `serverEntry` config.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/nuxt my-nuxt-app
cd my-nuxt-app
pnpm install
pnpm dev
```

## Endpoints

- `GET /todos/list` — list all todos
- `POST /todos/create` — create a todo (`{ "title": "..." }`)
- `POST /todos/toggle` — toggle completed (`{ "id": 1 }`)
- `POST /todos/remove` — delete a todo (`{ "id": 1 }`)

## Structure

```
server/server.ts   — Silgi procedures + router + fetch export
nuxt.config.ts     — nitro.serverEntry points to server.ts
app.vue            — Vue todo UI
```
