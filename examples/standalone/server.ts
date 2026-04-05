import { silgi, SilgiError } from 'silgi'
import { z } from 'zod'

const db = {
  users: [
    { id: 1, name: 'Alice', email: 'alice@silgi.dev' },
    { id: 2, name: 'Bob', email: 'bob@silgi.dev' },
  ],
  nextId: 3,
}

const s = silgi({
  context: (req) => ({
    db,
    headers: Object.fromEntries(req.headers),
  }),
})

const auth = s.guard((ctx) => {
  const token = ctx.headers.authorization?.replace('Bearer ', '')
  if (token !== 'secret') throw new SilgiError('UNAUTHORIZED')
  return { userId: 1 }
})

const appRouter = s.router({
  health: s.$resolve(() => ({ status: 'ok' })),
  users: {
    list: s
      .$input(z.object({ limit: z.number().optional() }))
      .$resolve(({ input, ctx }) => ctx.db.users.slice(0, input.limit ?? 10)),
    create: s
      .$use(auth)
      .$input(z.object({ name: z.string(), email: z.string().email() }))
      .$resolve(({ input, ctx }) => {
        const user = { id: ctx.db.nextId++, ...input }
        ctx.db.users.push(user)
        return user
      }),
  },
})

s.serve(appRouter, {
  port: 3000,
  scalar: true,
})
