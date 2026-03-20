import { silgi } from 'silgi'
import { z } from 'zod'

const k = silgi({ context: () => ({ db: 'nextjs-db' }) })

export const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'nextjs' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

export type AppRouter = typeof appRouter
