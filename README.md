<p align="center">
  <br>
  <img src=".github/assets/cover.png" alt="Silgi — Type-safe RPC framework for TypeScript" width="100%">
  <br><br>
  <a href="https://npmjs.com/package/silgi"><img src="https://img.shields.io/npm/v/silgi?style=flat&colorA=0a0908&colorB=edc462" alt="npm version"></a>
  <a href="https://npmjs.com/package/silgi"><img src="https://img.shields.io/npm/dm/silgi?style=flat&colorA=0a0908&colorB=edc462" alt="npm downloads"></a>
  <a href="https://github.com/productdevbook/silgi/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/productdevbook/silgi/ci.yml?style=flat&colorA=0a0908&colorB=edc462" alt="CI"></a>
  <a href="https://github.com/productdevbook/silgi/blob/main/LICENSE"><img src="https://img.shields.io/github/license/productdevbook/silgi?style=flat&colorA=0a0908&colorB=edc462" alt="license"></a>
</p>

End-to-end type-safe RPC framework for TypeScript. Single package — server, client, 15 plugins, 14 adapters. Full docs at [silgi.dev](https://silgi.dev).

## Install

```bash
pnpm add silgi
# or: npm install silgi / yarn add silgi / bun add silgi
```

Requires Node.js `>=24`.

## Minimal example

```ts
import { silgi } from 'silgi'

const k = silgi({
  context: (req) => ({ now: Date.now() }),
})

const hello = k.$resolve(({ ctx }) => ({ message: 'hi', at: ctx.now }))

const router = k.router({ hello })

export default k.handler(router)
```

Export `handler` from any Fetch-compatible runtime (Next.js App Router,
SvelteKit, Remix, Astro, SolidStart, Hono, srvx, Bun, Deno, Cloudflare
Workers, AWS Lambda via the hono adapter, …). Dedicated adapters for
Express, Nitro, NestJS, and Node's raw `http` live under
`silgi/express`, `silgi/nextjs`, `silgi/sveltekit`, etc.

Run a standalone server:

```ts
await k.serve(router, { port: 3000 })
```

## Documentation

- **[silgi.dev](https://silgi.dev)** — user guide, recipes, API reference.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev setup, commands, PR checklist.
- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — request pipeline, module layout, performance invariants.
- [`SECURITY.md`](./SECURITY.md) — threat model, reporting policy, security features.
- [`docs/rfcs/0001-de-magic.md`](./docs/rfcs/0001-de-magic.md) — the
  refactor that removed module-global mutable state, explicit schema
  converter injection, and per-instance context bridges.

## Credits

- [oRPC](https://github.com/unnoq/orpc) — Pipeline architecture, client proxy, error handling, contract-first workflow
- [tRPC](https://github.com/trpc/trpc) — Router/procedure model, end-to-end type inference
- [Elysia](https://github.com/elysiajs/elysia) — Sucrose-style static handler analysis

## License

MIT
