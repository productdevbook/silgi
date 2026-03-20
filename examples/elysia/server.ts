import { Elysia } from 'elysia'
import { katman } from 'katman'
import { katmanElysia } from 'katman/elysia'
import { z } from 'zod'

const k = katman({ context: () => ({ db: 'elysia-db' }) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'elysia' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

const app = new Elysia()
  .get('/', () => ({ name: 'Katman + Elysia', docs: '/rpc/health' }))
  .use(katmanElysia(appRouter, { prefix: '/rpc' }))
  .listen(3000)

console.log(`Katman + Elysia running at http://localhost:${app.server?.port}`)
