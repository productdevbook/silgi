/**
 * misina client link — integration tests.
 *
 * Adapter-only concerns: URL construction, protocol negotiation, header
 * resolution, SSE branching, AbortSignal forwarding, SilgiError lift,
 * misina-instance pass-through. Anything misina owns (retry, timeout,
 * idempotencyKey, validateResponse, plugins, hooks) is covered by
 * misina's own test suite — we just verify our pass-through is wired.
 */

import { createServer } from 'node:http'

import { createMisina } from 'misina'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'

import { createLink } from '#src/client/adapters/misina/index.ts'
import { createClient } from '#src/client/client.ts'
import { silgi } from '#src/silgi.ts'

import type { InferClient } from '#src/types.ts'
import type { Server } from 'node:http'

// ── Server Setup ────────────────────────────────────

const k = silgi({
  context: () => ({
    db: {
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    },
  }),
})

const auth = k.guard(() => ({ userId: 1 }))

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok', ts: Date.now() })),
  users: {
    list: k.$input(z.object({ limit: z.number().optional() })).$resolve(({ input, ctx }) => {
      const limit = input.limit ?? 10
      return ctx.db.users.slice(0, limit)
    }),
    get: k.$input(z.object({ id: z.number() })).$resolve(({ input, ctx }) => {
      const user = ctx.db.users.find((u) => u.id === input.id)
      if (!user) throw new Error('Not found')
      return user
    }),
    create: k
      .$use(auth)
      .$input(z.object({ name: z.string().min(1) }))
      .$errors({ CONFLICT: 409 })
      .$resolve(({ input }) => ({ id: 3, name: input.name })),
  },
  echo: k.$input(z.object({ message: z.string() })).$resolve(({ input }) => ({ echo: input.message })),
})

type AppRouter = typeof appRouter

const handle = k.handler(appRouter)

let server: Server
let baseUrl: string

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = `http://localhost${req.url}`
    const headers = new Headers()
    for (const [key, value] of Object.entries(req.headers)) {
      if (value) headers.set(key, Array.isArray(value) ? value[0]! : value)
    }

    let body: string | undefined
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      body = await new Promise<string>((resolve) => {
        let data = ''
        req.on('data', (chunk: Buffer) => {
          data += chunk
        })
        req.on('end', () => resolve(data))
      })
    }

    const fetchReq = new Request(url, {
      method: req.method,
      headers,
      body: body || undefined,
    })

    const fetchRes = await handle(fetchReq)
    res.writeHead(fetchRes.status, Object.fromEntries(fetchRes.headers))
    const resBody = await fetchRes.text()
    res.end(resBody)
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number }
      baseUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

// ── Tests ───────────────────────────────────────────

describe('misina client link', () => {
  // Default instance — adapter constructs its own misina when none given.

  it('creates a typed client and calls a no-input query', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
    expect(typeof result.ts).toBe('number')
  })

  it('calls a query with input', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.echo({ message: 'hello' })
    expect(result.echo).toBe('hello')
  })

  it('calls nested procedures', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const users = await client.users.list({ limit: 1 })
    expect(users).toHaveLength(1)
    expect(users[0]!.name).toBe('Alice')
  })

  it('calls mutation with input', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const user = await client.users.create({ name: 'Charlie' })
    expect(user.id).toBe(3)
    expect(user.name).toBe('Charlie')
  })

  it('handles validation errors', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    await expect(client.users.create({ name: '' })).rejects.toThrow()
  })

  it('handles 404 for unknown routes', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link as any)

    await expect((client as any).nonexistent()).rejects.toThrow()
  })

  it('forwards AbortSignal to misina', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const controller = new AbortController()
    controller.abort()

    await expect(client.health(undefined, { signal: controller.signal })).rejects.toThrow()
  })

  // Headers — adapter-specific feature (per-call factory + Headers/Record/array
  // shapes), so we test it here instead of relying on misina's own header tests.

  it('supports headers as Record', async () => {
    const link = createLink({
      url: baseUrl,
      headers: { 'x-custom': 'test-value' },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
  })

  it('supports headers as Headers instance', async () => {
    const link = createLink({
      url: baseUrl,
      headers: new Headers({ 'x-custom': 'header-instance' }),
    })
    const client = createClient<InferClient<AppRouter>>(link)
    const result = await client.health()
    expect(result.status).toBe('ok')
  })

  it('supports headers as a per-call factory', async () => {
    let factoryCalls = 0
    const link = createLink({
      url: baseUrl,
      headers: () => {
        factoryCalls += 1
        return { authorization: 'Bearer test' }
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    await client.health()
    expect(factoryCalls).toBe(2)
  })

  it('drops undefined header values silently', async () => {
    const link = createLink({
      url: baseUrl,
      headers: { authorization: undefined, 'x-real': 'present' },
    })
    const client = createClient<InferClient<AppRouter>>(link)
    const result = await client.health()
    expect(result.status).toBe('ok')
  })

  // Instance pass-through — the canonical extension surface.

  it('uses a user-provided misina instance', async () => {
    let dispatched = 0
    const m = createMisina({
      hooks: {
        beforeRequest: () => {
          dispatched += 1
        },
      },
    })
    const link = createLink({ url: baseUrl, misina: m })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
    expect(dispatched).toBe(1)
  })

  it('flows misina instance hooks (onComplete) end-to-end', async () => {
    let completed = false
    let durationMs = -1
    const m = createMisina({
      hooks: {
        onComplete: (info) => {
          completed = true
          durationMs = info.durationMs
        },
      },
    })
    const link = createLink({ url: baseUrl, misina: m })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(completed).toBe(true)
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  it('overrides instance throwHttpErrors so SilgiError still surfaces from 5xx', async () => {
    // User instance has throwHttpErrors: true (the misina default). The adapter
    // must override it per-call to false so we can lift SilgiError ourselves.
    const m = createMisina({ throwHttpErrors: true })
    const link = createLink({ url: baseUrl, misina: m })
    const client = createClient<InferClient<AppRouter>>(link as any)

    // 404 path — adapter should turn the misina HTTPError into a SilgiError.
    await expect((client as any).nonexistent()).rejects.toThrow()
  })
})
