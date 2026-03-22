import { z } from 'zod'

import { s } from '../instance'

import { LoginSchema, getUserByToken, login, logout } from './schema'

export const doLogin = s
  .$input(LoginSchema)
  .$errors({ UNAUTHORIZED: 401 })
  .$resolve(({ input, fail }) => {
    const result = login(input.email, input.password)
    if (!result) return fail('UNAUTHORIZED')
    return { token: result.token }
  })

export const doLogout = s
  .$input(z.object({ token: z.string() }))
  .$resolve(({ input }) => {
    logout(input.token)
    return { ok: true }
  })

export const me = s
  .$input(z.object({ token: z.string() }))
  .$errors({ UNAUTHORIZED: 401 })
  .$resolve(({ input, fail }) => {
    const user = getUserByToken(input.token)
    if (!user) return fail('UNAUTHORIZED')
    return user
  })
