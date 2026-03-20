import { s } from '../instance'
import { CreateTodoSchema, TodoIdSchema, TodoListSchema, TodoSchema, OkSchema, getNextId } from './schema'

import type { Todo } from './schema'

export const list = s
  .$route({ method: 'GET' })
  .$output(TodoListSchema)
  .$resolve(({ ctx }) => ctx.todos as Todo[])

export const create = s
  .$input(CreateTodoSchema)
  .$output(TodoSchema)
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
  .$output(TodoSchema)
  .$errors({ NOT_FOUND: 404 })
  .$resolve(({ input, ctx, fail }) => {
    const todo = (ctx.todos as Todo[]).find(t => t.id === input.id)
    if (!todo) return fail('NOT_FOUND')
    todo.completed = !todo.completed
    return todo
  })

export const remove = s
  .$input(TodoIdSchema)
  .$output(OkSchema)
  .$errors({ NOT_FOUND: 404 })
  .$resolve(({ input, ctx, fail }) => {
    const list = ctx.todos as Todo[]
    const idx = list.findIndex(t => t.id === input.id)
    if (idx === -1) return fail('NOT_FOUND')
    list.splice(idx, 1)
    return { ok: true }
  })
