import { z } from 'zod'

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

export interface User {
  id: number
  name: string
  email: string
}

const users: User[] = [
  { id: 1, name: 'Alice', email: 'alice@silgi.dev' },
  { id: 2, name: 'Bob', email: 'bob@silgi.dev' },
]

const sessions = new Map<string, number>()

export function login(email: string, _password: string): { token: string; user: User } | null {
  const user = users.find((u) => u.email === email)
  if (!user) return null
  const token = Math.random().toString(36).slice(2)
  sessions.set(token, user.id)
  return { token, user }
}

export function logout(token: string): boolean {
  return sessions.delete(token)
}

export function getUserByToken(token: string): User | undefined {
  const id = sessions.get(token)
  return id ? users.find((u) => u.id === id) : undefined
}
