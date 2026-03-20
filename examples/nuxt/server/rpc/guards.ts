import { getUserByToken } from './auth/schema'
import { s } from './instance'

export const authGuard = s.guard({
  errors: { UNAUTHORIZED: 401 },
  fn: (ctx) => {
    const token = (ctx as Record<string, unknown>).token as string | undefined
    if (!token) throw new Error('UNAUTHORIZED')
    const user = getUserByToken(token)
    if (!user) throw new Error('UNAUTHORIZED')
    return { user }
  },
})
