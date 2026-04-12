import { trace } from 'silgi/analytics'

import { s } from '../instance'

import { CreateTodoSchema, OkSchema, TodoIdSchema, TodoListSchema, TodoSchema, getNextId } from './schema'

import type { Todo } from './schema'

function simulateDb<T>(result: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(result), 2 + Math.random() * 3))
}

export const list = s
  .$route({ method: 'GET' })
  .$output(TodoListSchema)
  .$resolve(async ({ ctx }) => {
    return trace(ctx, 'db.todos.findMany', () => simulateDb([...ctx.todos]))
  })

export const create = s
  .$input(CreateTodoSchema)
  .$output(TodoSchema)
  .$resolve(async ({ input, ctx }) => {
    const todo: Todo = {
      id: getNextId(),
      title: input.title,
      completed: false,
      createdAt: new Date().toISOString(),
    }
    await trace(ctx, 'db.todos.insert', () => simulateDb(ctx.todos.push(todo)))
    return todo
  })

export const toggle = s
  .$input(TodoIdSchema)
  .$output(TodoSchema)
  .$errors({ NOT_FOUND: 404 })
  .$resolve(async ({ input, ctx, fail }) => {
    const todo = await trace(ctx, 'db.todos.findById', () => simulateDb(ctx.todos.find((t) => t.id === input.id)))
    if (!todo) return fail('NOT_FOUND')
    todo.completed = !todo.completed
    await trace(ctx, 'db.todos.update', () => simulateDb(true))
    return todo
  })

export const remove = s
  .$input(TodoIdSchema)
  .$output(OkSchema)
  .$errors({ NOT_FOUND: 404 })
  .$resolve(async ({ input, ctx, fail }) => {
    const idx = await trace(ctx, 'db.todos.findIndex', () => simulateDb(ctx.todos.findIndex((t) => t.id === input.id)))
    if (idx === -1) return fail('NOT_FOUND')
    await trace(ctx, 'db.todos.delete', () => simulateDb(ctx.todos.splice(idx, 1)))
    return { ok: true }
  })
