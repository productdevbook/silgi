import http from 'node:http'

import { serve as honoServe } from '@hono/node-server'
import { Hono } from 'hono'

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

const app = new Hono()
app.post('/users/list', async (c) => {
  const { limit = 10 } = await c.req.json()
  return c.json({ users: makeUsers(limit) })
})

const port = +(process.env.PORT || 3000)
const server = honoServe({ fetch: app.fetch, port }) as http.Server
server.once('listening', () => {
  console.log(`hono listening on http://127.0.0.1:${port}/`)
})
