import { z } from 'zod'

import { s } from '../instance'

import { LoginSchema, login, logout, getUserByToken } from './schema'

export const doLogin = s
  .$input(LoginSchema)
  .$errors({ UNAUTHORIZED: 401 })
  .$resolve(({ input, fail }) => {
    const token = login(input.username, input.password)
    if (!token) return fail('UNAUTHORIZED')
    return { token }
  })

export const doLogout = s.$input(z.object({ token: z.string() })).$resolve(({ input }) => {
  logout(input.token)
  return { ok: true }
})

export const me = s
  .$input(z.object({ token: z.string() }))
  .$errors({ UNAUTHORIZED: 401 })
  .$resolve(({ input, fail }) => {
    const user = getUserByToken(input.token)
    if (!user) return fail('UNAUTHORIZED')
    return { id: user.id, username: user.username, role: user.role }
  })
