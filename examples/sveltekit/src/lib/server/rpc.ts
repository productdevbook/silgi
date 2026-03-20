import { silgi } from 'silgi'
import { z } from 'zod'

const s = silgi({ context: () => ({ db: 'sveltekit-db' }) })

export const appRouter = s.router({
  health: s.$resolve(() => ({ status: 'ok', framework: 'sveltekit' })),
  echo: s.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: s.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

export type AppRouter = typeof appRouter
