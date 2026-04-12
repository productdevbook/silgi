import { serve } from 'srvx'

import { silgi } from '../../src/silgi.ts'

const makeUsers = (limit: number) => Array.from({ length: limit }, (_, i) => ({ id: i + 1, name: `User ${i + 1}` }))

const s = silgi({ context: () => ({}) })
const router = s.router({
  users: {
    list: s.$resolve(({ input }) => ({ users: makeUsers((input as any)?.limit ?? 10) })),
  },
})
const handler = s.handler(router)

const port = +(process.env.PORT || 3000)
const server = await serve({ port, hostname: '127.0.0.1', fetch: handler, silent: true })
await server.ready()
console.log(`silgi listening on ${server.url}`)
