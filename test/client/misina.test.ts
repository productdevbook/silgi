/**
 * misina client link — integration tests.
 *
 * Spins up a real silgi server and tests the misina-based client.
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

  it('supports custom headers', async () => {
    const link = createLink({
      url: baseUrl,
      headers: { 'x-custom': 'test-value' },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
  })

  it('supports dynamic headers', async () => {
    let headersCalled = false
    const link = createLink({
      url: baseUrl,
      headers: () => {
        headersCalled = true
        return { authorization: 'Bearer test' }
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(headersCalled).toBe(true)
  })

  it('supports timeout', async () => {
    const link = createLink({
      url: baseUrl,
      timeout: 5000,
    })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
  })

  it('supports AbortSignal', async () => {
    const link = createLink({ url: baseUrl })
    const client = createClient<InferClient<AppRouter>>(link)

    const controller = new AbortController()
    controller.abort()

    await expect(client.health(undefined, { signal: controller.signal })).rejects.toThrow()
  })

  it('supports beforeRequest hook', async () => {
    let intercepted = false
    const link = createLink({
      url: baseUrl,
      beforeRequest: () => {
        intercepted = true
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(intercepted).toBe(true)
  })

  it('supports afterResponse hook', async () => {
    let responseStatus = 0
    const link = createLink({
      url: baseUrl,
      afterResponse: ({ response }) => {
        if (response) responseStatus = response.status
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(responseStatus).toBe(200)
  })

  it('supports onComplete terminal hook', async () => {
    let completed = false
    let durationMs = -1
    const link = createLink({
      url: baseUrl,
      onComplete: (info) => {
        completed = true
        durationMs = info.durationMs
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(completed).toBe(true)
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })

  // ── Bring-your-own instance & extended hooks ──────────

  it('uses a user-provided misina instance', async () => {
    let dispatched = 0
    const m = createMisina({
      baseURL: baseUrl,
      throwHttpErrors: false,
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

  it('supports init hook (sync, runs before Request construction)', async () => {
    let initCalled = false
    const link = createLink({
      url: baseUrl,
      init: (resolved) => {
        initCalled = true
        resolved.headers['x-init'] = 'yes'
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(initCalled).toBe(true)
  })

  it('supports beforeRetry hook for token refresh / request rewrite', async () => {
    // Spin up a flaky server: 500 once, then 200.
    let calls = 0
    const flaky = createServer((req, res) => {
      calls += 1
      if (calls === 1) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'transient' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', ts: Date.now() }))
    })
    await new Promise<void>((resolve) => flaky.listen(0, '127.0.0.1', () => resolve()))
    const addr = flaky.address() as { port: number }
    const flakyUrl = `http://127.0.0.1:${addr.port}`

    let retryHookFired = false
    const link = createLink({
      url: flakyUrl,
      retry: { limit: 1, statusCodes: [500], methods: ['POST'] },
      beforeRetry: () => {
        retryHookFired = true
      },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
    expect(calls).toBe(2)
    expect(retryHookFired).toBe(true)

    flaky.close()
  })

  it('supports validateResponse — predicate can reject a 2xx response', async () => {
    // Adapter forces responseType: 'stream' so predicate inspects status/headers
    // (data is the ReadableStream at this stage). We reject status === 200 as
    // a contrived "treat success as failure" check.
    const link = createLink({
      url: baseUrl,
      validateResponse: ({ status }) => status !== 200,
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await expect(client.health()).rejects.toThrow()
  })

  it('supports totalTimeout (wall-clock cap across retries)', async () => {
    const link = createLink({
      url: baseUrl,
      totalTimeout: 5000,
    })
    const client = createClient<InferClient<AppRouter>>(link)

    const result = await client.health()
    expect(result.status).toBe('ok')
  })

  it('sends Idempotency-Key on retried mutations when idempotencyKey: auto', async () => {
    let observed: string | undefined
    let calls = 0
    const flaky = createServer((req, res) => {
      observed = req.headers['idempotency-key'] as string | undefined
      calls += 1
      if (calls === 1) {
        res.writeHead(503)
        res.end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', ts: Date.now() }))
    })
    await new Promise<void>((resolve) => flaky.listen(0, '127.0.0.1', () => resolve()))
    const addr = flaky.address() as { port: number }
    const flakyUrl = `http://127.0.0.1:${addr.port}`

    const link = createLink({
      url: flakyUrl,
      idempotencyKey: 'auto',
      retry: { limit: 1, statusCodes: [503], methods: ['POST'] },
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await client.health()
    expect(calls).toBe(2)
    expect(observed).toBeDefined()
    expect(observed).toMatch(/^[0-9a-f-]{36}$/i)

    flaky.close()
  })

  it('rejects disallowed protocols (allowedProtocols guard)', async () => {
    // baseUrl is http://...; only allow https → misina should refuse to dispatch.
    const link = createLink({
      url: baseUrl,
      allowedProtocols: ['https'],
    })
    const client = createClient<InferClient<AppRouter>>(link)

    await expect(client.health()).rejects.toThrow()
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

  it('drops undefined header values silently', async () => {
    const link = createLink({
      url: baseUrl,
      headers: { authorization: undefined, 'x-real': 'present' },
    })
    const client = createClient<InferClient<AppRouter>>(link)
    const result = await client.health()
    expect(result.status).toBe('ok')
  })
})
