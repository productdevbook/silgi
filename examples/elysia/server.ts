import { Elysia } from 'elysia'
import { silgi } from 'silgi'
import { silgiElysia } from 'silgi/elysia'
import { z } from 'zod'

const k = silgi({ context: () => ({ db: 'elysia-db' }) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'elysia' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

const app = new Elysia()
  .get('/', () => ({ name: 'Silgi + Elysia', docs: '/rpc/health' }))
  .use(silgiElysia(appRouter, { prefix: '/rpc' }))
  .listen(3000)

console.log(`Silgi + Elysia running at http://localhost:${app.server?.port}`)
