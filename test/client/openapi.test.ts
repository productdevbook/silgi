import { describe, it, expect, vi } from 'vitest'

describe('RPCLink relative URL', () => {
  it('supports relative URL like /rpc', async () => {
    const { RPCLink } = await import('#src/client/adapters/fetch/index.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new RPCLink({ url: '/rpc', fetch: mockFetch })
    await link.call(['users', 'list'], { limit: 10 }, {})
    expect(mockFetch).toHaveBeenCalledWith(
      '/rpc/users/list',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('supports relative URL with trailing slash', async () => {
    const { RPCLink } = await import('#src/client/adapters/fetch/index.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify('ok'), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new RPCLink({ url: '/api/', fetch: mockFetch })
    await link.call(['health'], undefined, {})
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})

describe('OpenAPILink', () => {
  it('makes POST requests by default', async () => {
    const { OpenAPILink } = await import('#src/client/openapi.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new OpenAPILink({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })

    const result = await link.call(['health'], undefined, {})
    expect(result).toEqual({ status: 'ok' })
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/health',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('uses GET when spec indicates', async () => {
    const { OpenAPILink } = await import('#src/client/openapi.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new OpenAPILink({
      url: 'https://api.example.com',
      spec: {
        paths: {
          '/users': { get: {} },
        },
      },
      fetch: mockFetch,
    })

    await link.call(['users'], { limit: 10 }, {})
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('limit=10'),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('supports relative URL like /api', async () => {
    const { OpenAPILink } = await import('#src/client/openapi.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new OpenAPILink({ url: '/api', fetch: mockFetch })
    await link.call(['users', 'list'], { limit: 5 }, {})
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/users/list',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('supports relative URL with trailing slash', async () => {
    const { OpenAPILink } = await import('#src/client/openapi.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new OpenAPILink({ url: '/api/', fetch: mockFetch })
    await link.call(['health'], undefined, {})
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('throws KatmanError on non-ok response', async () => {
    const { OpenAPILink } = await import('#src/client/openapi.ts')

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'nope' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const link = new OpenAPILink({ url: 'https://api.example.com', fetch: mockFetch })

    await expect(link.call(['missing'], {}, {})).rejects.toMatchObject({
      status: 404,
    })
  })
})
