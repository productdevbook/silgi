import express from 'express'
import { katman } from 'katman'
import { katmanExpress } from 'katman/express'
import { z } from 'zod'

const k = katman({ context: () => ({ db: 'express-db' }) })

const appRouter = k.router({
  health: k.query(() => ({ status: 'ok', framework: 'express' })),
  echo: k.query(z.object({ msg: z.string() }), ({ input }) => ({ echo: input.msg })),
  greet: k.query(z.object({ name: z.string() }), ({ input }) => ({ greeting: `Hello, ${input.name}!` })),
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
