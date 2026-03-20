import express from 'express'
import { silgi } from 'silgi'
import { silgiExpress } from 'silgi/express'
import { z } from 'zod'

const k = silgi({ context: () => ({ db: 'express-db' }) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'express' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

const app = express()
app.use(express.json())

app.get('/', (_req, res) => {
  res.json({ name: 'Silgi + Express', docs: '/rpc/health' })
})

app.use('/rpc', silgiExpress(appRouter))

app.listen(3000, () => {
  console.log('Silgi + Express running at http://localhost:3000')
})
