import * as auth from './auth'
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
    cached: demo.cached,
    clock: demo.clock,
    compute: demo.compute,
  },
})

export type AppRouter = typeof appRouter
