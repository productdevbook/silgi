import { describe, expect, it } from 'vitest'

import { silgi } from '#src/silgi.ts'

/**
 * Regression test for productdevbook/silgi#4 — createEventFetchAdapter
 * must propagate the framework event to the context factory even when a
 * middleware layer replaces the Request. The old WeakMap<Request, TEvent>
 * implementation would miss on the cloned request; the ALS-based envelope
 * survives because it rides the async call chain instead of object identity.
 */
interface FakeSvelteEvent {
  request: Request
  locals: { userId: string }
}

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  whoami: k.$resolve(({ ctx }) => ({ userId: (ctx as { userId?: string }).userId ?? null })),
})

describe('createEventFetchAdapter — event propagation', () => {
  it('resolves context from event when the Request is pristine', async () => {
    const { createHandler } = await import('#src/adapters/sveltekit.ts')
    const handler = createHandler<{ userId: string }>(appRouter, {
      prefix: '/api',
      context: (event: FakeSvelteEvent) => ({ userId: event.locals.userId }),
    })

    const request = new Request('http://localhost/api/whoami', { method: 'POST' })
    const res = await handler({ request, locals: { userId: 'alice' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'alice' })
  })

  it('resolves context even when the Request is a clone (body-read/URL-rewrite scenario)', async () => {
    const { createHandler } = await import('#src/adapters/sveltekit.ts')
    const handler = createHandler<{ userId: string }>(appRouter, {
      prefix: '/api',
      context: (event: FakeSvelteEvent) => ({ userId: event.locals.userId }),
    })

    // A framework or user middleware may hand the adapter a cloned Request
    // (e.g. after reading the body). ALS propagation means the event is
    // resolved through the async chain, not through the Request's identity.
    const original = new Request('http://localhost/api/whoami', { method: 'POST' })
    const cloned = new Request(original)
    const res = await handler({ request: cloned, locals: { userId: 'bob' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ userId: 'bob' })
  })

  it('isolates events across concurrent requests', async () => {
    const { createHandler } = await import('#src/adapters/sveltekit.ts')
    const handler = createHandler<{ userId: string }>(appRouter, {
      prefix: '/api',
      context: async (event: FakeSvelteEvent) => {
        // Insert an async hop to force interleaving between the two requests.
        await new Promise((r) => setTimeout(r, 5))
        return { userId: event.locals.userId }
      },
    })

    const mk = (userId: string) =>
      handler({ request: new Request('http://localhost/api/whoami', { method: 'POST' }), locals: { userId } })

    const [a, b, c] = await Promise.all([mk('alice'), mk('bob'), mk('carol')])
    expect(await a.json()).toEqual({ userId: 'alice' })
    expect(await b.json()).toEqual({ userId: 'bob' })
    expect(await c.json()).toEqual({ userId: 'carol' })
  })
})
