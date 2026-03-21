import { s } from './instance'
import * as todos from './todos'

export const appRouter = s.router({
  todos: {
    list: todos.list,
    create: todos.create,
    toggle: todos.toggle,
    remove: todos.remove,
  },
  clock: s
    .subscription()
    .$route({ ws: true })
    .$resolve(async function* () {
      for (let i = 0; i < 5; i++) {
        yield { tick: i + 1, time: new Date().toISOString() }
        await new Promise((r) => setTimeout(r, 1000))
      }
    }),
})

export type AppRouter = typeof appRouter
