import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { callable } from '#src/callable.ts'
import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

describe('callable()', () => {
  it('calls a procedure directly without HTTP', async () => {
    const proc = k.$input(z.object({ limit: z.number() })).$resolve(({ input }) => ({ items: input.limit }))

    const fn = callable(proc, { context: () => ({ db: 'test' }) })
    const result = await fn({ limit: 5 })
    expect(result).toEqual({ items: 5 })
  })

  it('runs guards in callable', async () => {
    const auth = k.guard(() => ({ userId: 42 }))
    const proc = k.$use(auth).$resolve(({ ctx }) => ({ user: (ctx as any).userId }))

    const fn = callable(proc, { context: () => ({}) })
    const result = await fn()
    expect(result).toEqual({ user: 42 })
  })
})
