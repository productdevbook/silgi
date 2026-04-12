import { z } from 'zod'

export const TodoSchema = z.object({
  id: z.number(),
  title: z.string(),
  completed: z.boolean(),
  createdAt: z.string(),
})

export const CreateTodoSchema = z.object({ title: z.string().min(1).max(200) })
export const TodoIdSchema = z.object({ id: z.number() })
export const TodoListSchema = z.array(TodoSchema)
export const OkSchema = z.object({ ok: z.boolean() })

export type Todo = z.infer<typeof TodoSchema>

// ── In-memory store ─────────────────────────────────

let nextId = 4

export const todos: Todo[] = [
  { id: 1, title: 'Buy groceries', completed: false, createdAt: '2026-03-20T10:00:00Z' },
  { id: 2, title: 'Write tests', completed: true, createdAt: '2026-03-20T11:00:00Z' },
  { id: 3, title: 'Deploy to production', completed: false, createdAt: '2026-03-20T12:00:00Z' },
]

export function getNextId() {
  return nextId++
}
