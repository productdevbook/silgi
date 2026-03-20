import { s } from '../instance'
import { CreateTodoSchema, TodoIdSchema, getNextId, todos } from './schema'

import type { Todo } from './schema'

export const list = s
  .$route({ method: 'GET' })
  .$resolve(({ ctx }) => ctx.todos as Todo[])

export const create = s
  .$input(CreateTodoSchema)
  .$resolve(({ input, ctx }) => {
    const todo: Todo = {
      id: getNextId(),
      title: input.title,
      completed: false,
      createdAt: new Date().toISOString(),
    }
    ;(ctx.todos as Todo[]).push(todo)
    return todo
  })

export const toggle = s
  .$input(TodoIdSchema)
  .$errors({ NOT_FOUND: 404 })
  .$resolve(({ input, ctx, fail }) => {
    const todo = (ctx.todos as Todo[]).find(t => t.id === input.id)
    if (!todo) fail('NOT_FOUND')
    todo.completed = !todo.completed
    return todo
  })

export const remove = s
  .$input(TodoIdSchema)
  .$errors({ NOT_FOUND: 404 })
  .$resolve(({ input, ctx, fail }) => {
    const list = ctx.todos as Todo[]
    const idx = list.findIndex(t => t.id === input.id)
    if (idx === -1) fail('NOT_FOUND')
    list.splice(idx, 1)
    return { ok: true }
  })
