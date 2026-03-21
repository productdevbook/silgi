import { s } from './rpc/instance'
import { appRouter } from './rpc/router'

const handle = s.handler(appRouter, { scalar: true })

Bun.serve({
  port: 3000,
  fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/') {
      return Response.json({
        name: 'Silgi + Bun',
        docs: '/reference',
        routes: ['/todos/list', '/todos/create', '/todos/toggle', '/todos/remove'],
      })
    }

    return handle(req)
  },
})

console.log('Silgi + Bun running at http://localhost:3000')
console.log('  Scalar API Reference at http://localhost:3000/reference')
