import express from 'express'
import { katman } from 'katman'
import { katmanExpress } from 'katman/express'
import { z } from 'zod'

const k = katman({ context: () => ({ db: 'express-db' }) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', framework: 'express' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ greeting: `Hello, ${input.name}!` })),
})

const app = express()
app.use(express.json())

app.get('/', (_req, res) => {
  res.json({ name: 'Katman + Express', docs: '/rpc/health' })
})

app.use('/rpc', katmanExpress(appRouter))

app.listen(3000, () => {
  console.log('Katman + Express running at http://localhost:3000')
})
