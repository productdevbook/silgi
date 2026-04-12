import { silgi } from 'silgi'
import { z } from 'zod'

const s = silgi({ context: () => ({}) })

const appRouter = s.router({
  health: s.$resolve(() => ({ status: 'ok' })),
  echo: s.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: s
    .$input(z.object({ name: z.string() }))
    .$route({ method: 'GET' })
    .$resolve(({ input }) => ({ hello: input.name })),
})

export default { fetch: s.handler(appRouter) }
