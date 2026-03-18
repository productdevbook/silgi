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

## License

MIT
