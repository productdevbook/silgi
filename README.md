# Katman

Type-safe RPC framework for TypeScript. Compiled pipelines. Single package.

```bash
npm install katman
```

```ts
import { katman } from "katman"
import { z } from "zod"

const k = katman({ context: (req) => ({ db: getDB() }) })

const users = k.query(
  z.object({ limit: z.number().optional() }),
  ({ input, ctx }) => ctx.db.users.find({ take: input.limit }),
)

k.serve(k.router({ users }), { port: 3000, scalar: true })
```

## Documentation

[katman.dev](https://katman.dev)

## Credits

Katman is built on the shoulders of great open source projects. We took heavy inspiration from and directly use:

- [oRPC](https://github.com/unnoq/orpc) — Type-safe RPC framework. Pipeline architecture, client proxy pattern, error handling, and contract-first workflow are inspired by oRPC.
- [tRPC](https://github.com/trpc/trpc) — The original type-safe RPC for TypeScript. Router/procedure model and end-to-end type inference concepts originate here.
- [Elysia](https://github.com/elysiajs/elysia) — Sucrose-style static handler analysis (`Function.toString()` optimization) is inspired by Elysia's AOT compilation approach.
- [Hono](https://github.com/honojs/hono) — Lightweight HTTP framework. Middleware composition patterns and multi-runtime support approach.
- [Vite](https://github.com/vitejs/vite) — Documentation site design language is adapted from Vite's landing page structure.


## License

MIT
