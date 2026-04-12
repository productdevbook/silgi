import { z } from 'zod'

export const LoginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export interface User {
  id: number
  username: string
  role: 'admin' | 'user'
}

// In-memory users + sessions
const users: User[] = [
  { id: 1, username: 'admin', role: 'admin' },
  { id: 2, username: 'user', role: 'user' },
]

const sessions = new Map<string, User>()

export function login(username: string, _password: string): string | null {
  // Demo: any password works, just check username exists
  const user = users.find((u) => u.username === username)
  if (!user) return null
  const token = `token_${user.id}_${Date.now()}`
  sessions.set(token, user)
  return token
}

export function getUserByToken(token: string): User | null {
  return sessions.get(token) ?? null
}

export function logout(token: string): boolean {
  return sessions.delete(token)
}
