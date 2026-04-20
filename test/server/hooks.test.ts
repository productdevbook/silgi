/**
 * Lifecycle hooks — powered by hookable.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'

// ── Setup ──────────────────────────────────────────

function createApp(hooks?: Parameters<typeof silgi>[0]['hooks']) {
  const k = silgi({
    context: () => ({ db: true }),
    hooks,
  })
  const router = k.router({
    health: k.$resolve(() => ({ status: 'ok' })),
    echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
    fail: k.$resolve(() => {
      throw new Error('boom')
    }),
  })
  const handle = k.handler(router)
  return { k, handle }
}

async function get(handle: (req: Request) => Promise<Response>, path: string) {
  return handle(new Request(`http://localhost/${path}`))
}

async function post(handle: (req: Request) => Promise<Response>, path: string, body: unknown) {
  return handle(
    new Request(`http://localhost/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

// ── Tests ──────────────────────────────────────────

describe('lifecycle hooks', () => {
  it('calls request hook before processing', async () => {
    const events: string[] = []
    const { handle } = createApp({
      request: ({ path }) => {
        events.push(`req:${path}`)
      },
    })

    await get(handle, 'health')
    expect(events).toEqual(['req:health'])
  })

  it('calls response hook after success', async () => {
    const events: any[] = []
    const { handle } = createApp({
      response: (e) => {
        events.push({ path: e.path, output: e.output })
      },
    })

    await get(handle, 'health')
    expect(events).toHaveLength(1)
    expect(events[0].path).toBe('health')
    expect(events[0].output).toEqual({ status: 'ok' })
  })

  it('response hook includes durationMs', async () => {
    let duration = -1
    const { handle } = createApp({
      response: (e) => {
        duration = e.durationMs
      },
    })

    await get(handle, 'health')
    expect(duration).toBeGreaterThanOrEqual(0)
    expect(duration).toBeLessThan(100) // should be sub-ms
  })

  it('calls error hook on failure', async () => {
    const errors: any[] = []
    const { handle } = createApp({
      error: (e) => {
        errors.push(e.path)
      },
    })

    await get(handle, 'fail')
    expect(errors).toEqual(['fail'])
  })

  it('request hook receives input', async () => {
    let captured: unknown
    const { handle } = createApp({
      request: (e) => {
        captured = e.input
      },
    })

    await post(handle, 'echo', { msg: 'hello' })
    expect(captured).toEqual({ msg: 'hello' })
  })

  it('supports multiple hooks via array', async () => {
    const log1: string[] = []
    const log2: string[] = []
    const { handle } = createApp({
      request: [
        ({ path }) => {
          log1.push(path)
        },
        ({ path }) => {
          log2.push(path)
        },
      ],
    })

    await get(handle, 'health')
    expect(log1).toEqual(['health'])
    expect(log2).toEqual(['health'])
  })

  it('supports dynamic hook registration via k.hook()', async () => {
    const { k, handle } = createApp()
    const events: string[] = []

    const unhook = k.hook('request', ({ path }) => {
      events.push(path)
    })

    await get(handle, 'health')
    expect(events).toEqual(['health'])

    // Unregister
    unhook()
    await get(handle, 'health')
    expect(events).toEqual(['health']) // no second entry
  })

  it('k.removeHook() removes a specific hook', async () => {
    const { k, handle } = createApp()
    const events: string[] = []

    const fn = ({ path }: { path: string }) => {
      events.push(path)
    }
    k.hook('request', fn)

    await get(handle, 'health')
    expect(events).toHaveLength(1)

    k.removeHook('request', fn)
    await get(handle, 'health')
    expect(events).toHaveLength(1) // not called again
  })

  it('no hooks = zero overhead (no errors)', async () => {
    const { handle } = createApp() // no hooks
    const res = await get(handle, 'health')
    expect(res.status).toBe(200)
  })

  it("hooks don't affect response content", async () => {
    const { handle } = createApp({
      request: () => {},
      response: () => {},
    })

    const res = await get(handle, 'health')
    const body = await res.json()
    expect(body.status).toBe('ok')
  })

  it('throwing hooks are logged but never fail the request', async () => {
    // Prior impl silently swallowed hook errors via `catch {}` — a
    // misspelled property or failed `fetch` inside a user hook just
    // vanished, with no signal that anything was wrong. Now we log.
    const calls: Array<[string, unknown]> = []
    const origError = console.error
    console.error = (...args: unknown[]) => calls.push(['error', args])
    try {
      const { handle } = createApp({
        request: () => {
          throw new Error('sync hook boom')
        },
        response: async () => {
          throw new Error('async hook boom')
        },
      })

      const res = await get(handle, 'health')
      // Request itself succeeds
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')

      // Wait a tick for the async hook rejection to surface
      await new Promise((r) => setTimeout(r, 10))

      const messages = calls.map(([, args]) => (args as unknown[]).join(' '))
      expect(messages.some((m) => m.includes('sync hook boom'))).toBe(true)
      expect(messages.some((m) => m.includes('async hook boom'))).toBe(true)
    } finally {
      console.error = origError
    }
  })
})
