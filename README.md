<p align="center">
  <br>
  <img src=".github/assets/cover.png" alt="Katman — Type-safe RPC framework for TypeScript" width="100%">
  <br><br>
  <a href="https://npmjs.com/package/katman"><img src="https://img.shields.io/npm/v/katman?style=flat&colorA=0a0908&colorB=edc462" alt="npm version"></a>
  <a href="https://npmjs.com/package/katman"><img src="https://img.shields.io/npm/dm/katman?style=flat&colorA=0a0908&colorB=edc462" alt="npm downloads"></a>
  <a href="https://github.com/productdevbook/katman/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/productdevbook/katman/ci.yml?style=flat&colorA=0a0908&colorB=edc462" alt="CI"></a>
  <a href="https://github.com/productdevbook/katman/blob/main/LICENSE"><img src="https://img.shields.io/github/license/productdevbook/katman?style=flat&colorA=0a0908&colorB=edc462" alt="license"></a>
</p>

## Quick Start

```bash
npm install katman
```

```ts
import { katman } from 'katman'
import { z } from 'zod'

const k = katman({ context: (req) => ({ db: getDB() }) })

const appRouter = k.router({
  users: {
    list: k.query(
      z.object({ limit: z.number().optional() }),
      ({ input, ctx }) => ctx.db.users.find({ take: input.limit }),
    ),
  },
})

k.serve(appRouter, { port: 3000, scalar: true })
```

## Features

- **Single package** — server, client, 15 plugins, 15 adapters. One install.
- **Compiled pipeline** — guards unrolled, handlers pre-linked at startup.
- **Guard / Wrap** — guards enrich context (flat, sync fast-path). Wraps run before + after (onion).
- **Content negotiation** — JSON, MessagePack, devalue. Automatic from `Accept` header.
- **Contract-first** — define API shape, share types, implement separately.
- **Standard Schema** — Zod, Valibot, ArkType.

## Adapters

| | Import |
|---|---|
| Standalone | `k.serve()` / `k.handler()` |
| Nitro v3 | `katman/nitro` |
| H3 v2 | `katman/h3` |
| Hono | `katman/hono` |
| Express | `katman/express` |
| Fastify | `katman/fastify` |
| Elysia | `katman/elysia` |
| Next.js | `katman/nextjs` |
| Nuxt | via `katman/nitro` |
| SvelteKit | `katman/sveltekit` |
| Remix | `katman/remix` |
| Astro | `katman/astro` |
| SolidStart | `katman/solidstart` |
| NestJS | `katman/nestjs` |
| AWS Lambda | `katman/aws-lambda` |
| MessagePort | `katman/message-port` |

## Integrations

- **TanStack Query** — `queryOptions`, `mutationOptions`, `infiniteOptions`, `skipToken`
- **React Server Actions** — `createAction`, `useServerAction`, `useOptimisticServerAction`
- **AI SDK** — `routerToTools()` turns procedures into LLM tools
- **tRPC Interop** — `fromTRPC()` for incremental migration

## Examples

```bash
npx giget@latest gh:productdevbook/katman/examples/standalone my-app
npx giget@latest gh:productdevbook/katman/examples/hono my-hono-app
npx giget@latest gh:productdevbook/katman/examples/nextjs my-nextjs-app
npx giget@latest gh:productdevbook/katman/examples/nuxt my-nuxt-app
```

10 examples: standalone, hono, express, elysia, nitro, nitro-h3, nextjs, nuxt, sveltekit, client-react.

## Documentation

[katman.silgi.dev](https://katman.silgi.dev)

## Credits

- [oRPC](https://github.com/unnoq/orpc) — Pipeline architecture, client proxy, error handling, contract-first workflow
- [tRPC](https://github.com/trpc/trpc) — Router/procedure model, end-to-end type inference
- [Elysia](https://github.com/elysiajs/elysia) — Sucrose-style static handler analysis
- [Hono](https://github.com/honojs/hono) — Middleware composition, multi-runtime support

## License

MIT
