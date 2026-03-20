# Silgi + Nuxt — Todo App

A todo app with domain-driven server structure using Silgi RPC and Nuxt 5.

## Quick Start

```bash
npx giget@latest gh:productdevbook/silgi/examples/nuxt my-nuxt-app
cd my-nuxt-app
pnpm install
pnpm dev
```

## Structure

```
server.ts                      — Entry point: exports { fetch }
server/
  rpc/
    instance.ts                — Silgi instance + context
    router.ts                  — Root router (assembles domains)
    todos/
      index.ts                 — Todo procedures (list, create, toggle, remove)
      schema.ts                — Zod schemas + in-memory store
app.vue                        — Vue todo UI (Tailwind CSS)
nuxt.config.ts                 — Nuxt config
```
