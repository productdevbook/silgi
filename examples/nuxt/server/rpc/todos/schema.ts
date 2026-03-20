import { z } from 'zod'

export const CreateTodoSchema = z.object({ title: z.string().min(1).max(200) })
export const TodoIdSchema = z.object({ id: z.number() })

export interface Todo {
  id: number
  title: string
  completed: boolean
  createdAt: string
}

let nextId = 4

export const todos: Todo[] = [
  { id: 1, title: 'Buy groceries', completed: false, createdAt: '2026-03-20T10:00:00Z' },
  { id: 2, title: 'Write tests', completed: true, createdAt: '2026-03-20T11:00:00Z' },
  { id: 3, title: 'Deploy to production', completed: false, createdAt: '2026-03-20T12:00:00Z' },
]

export function getNextId() {
  return nextId++
}
