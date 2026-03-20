import { katman } from 'katman'
import { z } from 'zod'

const k = katman({ context: () => ({ db: 'nuxt-db' }) })

export const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'nuxt' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

export type AppRouter = typeof appRouter
