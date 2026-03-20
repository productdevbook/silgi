import { s } from './instance'
import * as todos from './todos'

export const appRouter = s.router({
  todos: {
    list: todos.list,
    create: todos.create,
    toggle: todos.toggle,
    remove: todos.remove,
  },
})

export type AppRouter = typeof appRouter
