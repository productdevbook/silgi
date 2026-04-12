import express from 'express'

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

const app = express()
app.use(express.json())
app.post('/users/list', (req, res) => {
  const { limit = 10 } = req.body
  res.json({ users: makeUsers(limit) })
})

const port = +(process.env.PORT || 3000)
app.listen(port, '127.0.0.1', () => {
  console.log(`express listening on http://127.0.0.1:${port}/`)
})
