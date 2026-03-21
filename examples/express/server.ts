import express from 'express'
import { silgiExpress } from 'silgi/express'
import { attachWebSocket } from 'silgi/ws'

import { appRouter } from './rpc/router'

const app = express()
app.use(express.json())

app.get('/', (_req, res) => {
  res.json({ name: 'Silgi + Express', routes: ['/rpc/todos/list', '/rpc/todos/create', 'ws://localhost:3000 (clock)'] })
})

app.use('/rpc', silgiExpress(appRouter))

const server = app.listen(3000, () => {
  console.log('Silgi + Express running at http://localhost:3000')
  console.log('  WebSocket RPC at ws://localhost:3000')
})

await attachWebSocket(server, appRouter)
