import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { katman } from 'katman'
import { katmanHono } from 'katman/hono'
import { z } from 'zod'

const k = katman({ context: () => ({ db: 'hono-db' }) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'hono' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
})

const app = new Hono()
app.get('/', (c) => c.json({ name: 'Katman + Hono', docs: '/rpc/health' }))
app.all('/rpc/*', katmanHono(appRouter, { prefix: '/rpc' }))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Katman + Hono running at http://localhost:${info.port}`)
})
