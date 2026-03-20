import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { silgi } from 'silgi'
import { silgiHono } from 'silgi/hono'
import { z } from 'zod'

const k = silgi({ context: () => ({ db: 'hono-db' }) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'hono' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
})

const app = new Hono()
app.get('/', (c) => c.json({ name: 'Silgi + Hono', docs: '/rpc/health' }))
app.all('/rpc/*', silgiHono(appRouter, { prefix: '/rpc' }))

serve({ fetch: app.fetch, port: 3000 }, (info) => {
  console.log(`Silgi + Hono running at http://localhost:${info.port}`)
})
