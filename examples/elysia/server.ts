import { Elysia } from 'elysia'
import { silgi } from 'silgi'
import { silgiElysia } from 'silgi/elysia'
import { z } from 'zod'

const s = silgi({ context: () => ({ db: 'elysia-db' }) })

const appRouter = s.router({
  health: s.$resolve(() => ({ status: 'ok', framework: 'elysia' })),
  echo: s.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: s.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

const app = new Elysia()
  .get('/', () => ({ name: 'Silgi + Elysia', docs: '/rpc/health' }))
  .use(silgiElysia(appRouter, { prefix: '/rpc' }))
  .listen(3000)

console.log(`Silgi + Elysia running at http://localhost:${app.server?.port}`)
