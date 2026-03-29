import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'

import { RPCLink } from '#src/client/adapters/fetch/index.ts'
import { createSafeClient } from '#src/client/client.ts'
import { consumeIterator, mapIterator } from '#src/client/consume.ts'
import { DynamicLink } from '#src/client/dynamic-link.ts'
import { withOtel } from '#src/client/plugins/otel.ts'
import { withRetry } from '#src/client/plugins/retry.ts'
import { createServerClient } from '#src/client/server.ts'
import { resolveRoute, substituteParams } from '#src/core/router-utils.ts'
import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({}) })

// ── Path Param Substitution ────────────────────────

describe('substituteParams()', () => {
  it('replaces :param with input values', () => {
    const result = substituteParams('/users/:id/posts/:postId', { id: 42, postId: 99, extra: 'keep' })
    expect(result.url).toBe('/users/42/posts/99')
    expect(result.remainingInput).toEqual({ extra: 'keep' })
  })

  it('removes input entirely when all params used', () => {
    const result = substituteParams('/users/:id', { id: 42 })
    expect(result.url).toBe('/users/42')
    expect(result.remainingInput).toBeUndefined()
  })

  it('passes through non-object input', () => {
    const result = substituteParams('/users/:id', 'hello')
    expect(result.url).toBe('/users/:id')
    expect(result.remainingInput).toBe('hello')
  })

  it('encodes param values', () => {
    const result = substituteParams('/files/:name', { name: 'hello world.txt' })
    expect(result.url).toBe('/files/hello%20world.txt')
  })
})

describe('path param substitution in RPCLink', () => {
  it('substitutes :id in custom route path from input', async () => {
    const router = k.router({
      users: {
        byId: k
          .$route({ method: 'GET', path: '/api/users/:id' })
          .$resolve(({ params }: any) => ({ userId: params.id })),
      },
    })
    const handle = k.handler(router)

    const link = new RPCLink({
      url: 'http://localhost',
      router,
      fetch: (req) => handle(req instanceof Request ? req : new Request(req)),
    })

    const result = await link.call(['users', 'byId'], { id: '42' }, {})
    expect(result).toEqual({ userId: '42' })
  })
})

// ── createSafeClient ───────────────────────────────

describe('createSafeClient()', () => {
  it('wraps successful calls in SafeResult', async () => {
    const router = k.router({
      health: k.$resolve(() => ({ status: 'ok' })),
    })
    const handle = k.handler(router)
    const link = new RPCLink({
      url: 'http://localhost',
      fetch: (req) => handle(req instanceof Request ? req : new Request(req)),
    })

    const client = createSafeClient(link)
    const result = await (client as any).health()
    expect(result.isSuccess).toBe(true)
    expect(result.data).toEqual({ status: 'ok' })
    expect(result.error).toBeNull()
  })

  it('wraps errors in SafeResult', async () => {
    const router = k.router({
      fail: k.$resolve(() => {
        throw new Error('boom')
      }),
    })
    const handle = k.handler(router)
    const link = new RPCLink({
      url: 'http://localhost',
      fetch: (req) => handle(req instanceof Request ? req : new Request(req)),
    })

    const client = createSafeClient(link)
    const result = await (client as any).fail()
    expect(result.isError).toBe(true)
    expect(result.error).toBeDefined()
    expect(result.data).toBeUndefined()
  })
})

// ── Async DynamicLink ──────────────────────────────

describe('DynamicLink async selector', () => {
  it('supports async link selection', async () => {
    const router = k.router({
      health: k.$resolve(() => ({ status: 'ok' })),
    })
    const handle = k.handler(router)
    const baseLink = new RPCLink({
      url: 'http://localhost',
      fetch: (req) => handle(req instanceof Request ? req : new Request(req)),
    })

    const link = new DynamicLink(async () => {
      // Simulate lazy import
      await new Promise((r) => setTimeout(r, 1))
      return baseLink
    })

    const result = await link.call(['health'], undefined, {})
    expect(result).toEqual({ status: 'ok' })
  })
})

// ── Retry-After Header ─────────────────────────────

describe('withRetry Retry-After', () => {
  it('respects Retry-After seconds header', async () => {
    let attempt = 0
    const mockLink = {
      async call() {
        attempt++
        if (attempt < 2) {
          const error: any = new Error('Rate limited')
          error.status = 429
          error.response = { status: 429, headers: new Headers({ 'retry-after': '0' }) }
          throw error
        }
        return { ok: true }
      },
    }

    const link = withRetry(mockLink, { maxRetries: 3, respectRetryAfter: true, baseDelay: 10000 })
    const result = await link.call([], undefined, {})
    expect(result).toEqual({ ok: true })
    // Should have used Retry-After: 0 (0ms) instead of baseDelay (10s)
    expect(attempt).toBe(2)
  })
})

// ── Client OTel ────────────────────────────────────

describe('withOtel client plugin', () => {
  it('creates spans around calls', async () => {
    const spans: any[] = []
    const mockTracer = {
      startSpan(name: string, options: any) {
        const span = {
          name,
          attributes: { ...options?.attributes },
          status: undefined as any,
          events: [] as any[],
          ended: false,
          setAttribute(k: string, v: any) {
            span.attributes[k] = v
          },
          setStatus(s: any) {
            span.status = s
          },
          addEvent(n: string, attrs: any) {
            span.events.push({ name: n, attributes: attrs })
          },
          end() {
            span.ended = true
          },
        }
        spans.push(span)
        return span
      },
    }

    const router = k.router({ health: k.$resolve(() => 'ok') })
    const handle = k.handler(router)
    const baseLink = new RPCLink({
      url: 'http://localhost',
      fetch: (req) => handle(req instanceof Request ? req : new Request(req)),
    })

    const link = withOtel(baseLink, { tracer: mockTracer })
    await link.call(['health'], undefined, {})

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('rpc.client/health')
    expect(spans[0].attributes['rpc.system']).toBe('silgi')
    expect(spans[0].status.code).toBe(0)
    expect(spans[0].ended).toBe(true)
  })
})

// ── consumeIterator ────────────────────────────────

describe('consumeIterator()', () => {
  it('consumes async iterator with callbacks', async () => {
    const values: number[] = []
    async function* gen() {
      yield 1
      yield 2
      yield 3
    }

    let finished = false
    await consumeIterator(gen(), {
      onEvent: (v) => {
        values.push(v)
      },
      onFinish: () => {
        finished = true
      },
    })

    expect(values).toEqual([1, 2, 3])
    expect(finished).toBe(true)
  })

  it('calls onError on failure', async () => {
    async function* gen() {
      yield 1
      throw new Error('boom')
    }

    let caughtError: Error | undefined
    await consumeIterator(gen(), {
      onError: (err) => {
        caughtError = err
      },
    })

    expect(caughtError?.message).toBe('boom')
  })
})

describe('mapIterator()', () => {
  it('maps values', async () => {
    async function* gen() {
      yield 1
      yield 2
    }

    const mapped = mapIterator(gen(), (v) => v * 10)
    const results: number[] = []
    for await (const v of mapped) results.push(v)
    expect(results).toEqual([10, 20])
  })
})

// ── createServerClient with $route ─────────────────

describe('createServerClient $route resolution', () => {
  it('resolves $route paths for server client', async () => {
    const router = k.router({
      auth: {
        login: k.$route({ path: '/api/login' }).$resolve(() => ({ token: 'abc' })),
      },
    })
    const client = createServerClient(router, { context: () => ({}) })
    const result = await (client as any).auth.login()
    expect(result).toEqual({ token: 'abc' })
  })
})
