import Fastify from 'fastify'

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

const app = Fastify()
app.post('/users/list', async (req) => {
  const { limit = 10 } = req.body as any
  return { users: makeUsers(limit) }
})

const port = +(process.env.PORT || 3000)
await app.listen({ port, host: '127.0.0.1' })
console.log(`fastify listening on http://127.0.0.1:${port}/`)
