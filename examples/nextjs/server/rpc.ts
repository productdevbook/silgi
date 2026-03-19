import { katman } from 'katman'
import { z } from 'zod'

const k = katman({ context: () => ({ db: 'nextjs-db' }) })

export const appRouter = k.router({
  health: k.query(() => ({ status: 'ok', framework: 'nextjs' })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.query(z.object({ name: z.string() }), ({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

export type AppRouter = typeof appRouter
