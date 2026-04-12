import { z } from 'zod'

import * as auth from './auth'
import { getWorkerClient } from './broker/client'
import * as demo from './demo'
import { s } from './instance'
import * as todos from './todos'

export const appRouter = s.router({
  auth: {
    login: auth.doLogin,
    logout: auth.doLogout,
    me: auth.me,
  },
  todos: {
    list: todos.list,
    create: todos.create,
    toggle: todos.toggle,
    remove: todos.remove,
  },
  demo: {
    slow: demo.slow,
    httpCached: demo.httpCached,
    serverCached: demo.serverCached,
    invalidateCache: demo.invalidateCache,
    clock: demo.clock,
    compute: demo.compute,
  },
  broker: {
    ping: s.$resolve(async () => {
      const worker = await getWorkerClient()
      return worker.ping()
    }),
    uppercase: s.$input(z.object({ text: z.string() })).$resolve(async ({ input }) => {
      const worker = await getWorkerClient()
      return worker.uppercase({ text: input.text })
    }),
    fib: s.$input(z.object({ n: z.number().int().min(0).max(40) })).$resolve(async ({ input }) => {
      const worker = await getWorkerClient()
      return worker.fib({ n: input.n })
    }),
  },
})

export type AppRouter = typeof appRouter
