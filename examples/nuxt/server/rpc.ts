import { silgi } from 'silgi'
import { z } from 'zod'

// ── Types ───────────────────────────────────────────

interface Todo {
  id: number
  title: string
  completed: boolean
  createdAt: string
}

// ── In-memory store ─────────────────────────────────

let nextId = 4
const todos: Todo[] = [
  { id: 1, title: 'Buy groceries', completed: false, createdAt: '2026-03-20T10:00:00Z' },
  { id: 2, title: 'Write tests', completed: true, createdAt: '2026-03-20T11:00:00Z' },
  { id: 3, title: 'Deploy to production', completed: false, createdAt: '2026-03-20T12:00:00Z' },
]

// ── Silgi instance ──────────────────────────────────

const s = silgi({
  context: () => ({ todos }),
})

// ── Procedures ──────────────────────────────────────

const list = s.$route({ method: 'GET' }).$resolve(({ ctx }) => ctx.todos)

const create = s.$input(z.object({ title: z.string().min(1).max(200) })).$resolve(({ input, ctx }) => {
  const todo: Todo = {
    id: nextId++,
    title: input.title,
    completed: false,
    createdAt: new Date().toISOString(),
  }
  ctx.todos.push(todo)
  return todo
})

const toggle = s
  .$input(z.object({ id: z.number() }))
  .$errors({ NOT_FOUND: 404 })
  .$resolve(({ input, ctx, fail }) => {
    const todo = ctx.todos.find((t) => t.id === input.id)
    if (!todo) fail('NOT_FOUND')
    todo.completed = !todo.completed
    return todo
  })

const remove = s
  .$input(z.object({ id: z.number() }))
  .$errors({ NOT_FOUND: 404 })
  .$resolve(({ input, ctx, fail }) => {
    const idx = ctx.todos.findIndex((t) => t.id === input.id)
    if (idx === -1) fail('NOT_FOUND')
    ctx.todos.splice(idx, 1)
    return { ok: true }
  })

// ── Router ──────────────────────────────────────────

export const appRouter = s.router({
  todos: {
    list,
    create,
    toggle,
    remove,
  },
})

export type AppRouter = typeof appRouter
