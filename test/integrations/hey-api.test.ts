import { describe, it, expect, vi } from 'vitest'

import { experimental_toSilgiClient } from '#src/integrations/hey-api/to-silgi-client.ts'

describe('experimental_toSilgiClient', () => {
  it('should ignore non-function properties', () => {
    const client = experimental_toSilgiClient({
      listPlanets: () => Promise.resolve({ data: [], request: new Request('http://x'), response: new Response() }),
      somethingElse: 123,
    })

    expect(client.somethingElse).toBeUndefined()
    expect(client.listPlanets).toBeDefined()
  })

  it('works', async () => {
    const mockData = [{ id: 'earth', name: 'Earth' }]
    const mockRequest = new Request('http://example.com/planets')
    const mockResponse = new Response()

    const sdk = {
      planetList: vi.fn().mockResolvedValue({
        data: mockData,
        request: mockRequest,
        response: mockResponse,
      }),
    }

    const client = experimental_toSilgiClient(sdk)
    const result = await client.planetList()

    expect(result).toEqual({
      body: mockData,
      request: mockRequest,
      response: mockResponse,
    })

    expect(sdk.planetList).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      headers: {},
      throwOnError: true,
    })
  })

  it('forwards input options', async () => {
    const sdk = {
      planetList: vi.fn().mockResolvedValue({
        data: [],
        request: new Request('http://x'),
        response: new Response(),
      }),
    }

    const client = experimental_toSilgiClient(sdk)
    await client.planetList({ query: { limit: 10, offset: 0 } })

    expect(sdk.planetList).toHaveBeenCalledWith({
      query: { limit: 10, offset: 0 },
      signal: expect.any(AbortSignal),
      headers: {},
      throwOnError: true,
    })
  })

  it('with lastEventId', async () => {
    const sdk = {
      planetList: vi.fn().mockResolvedValue({
        data: [],
        request: new Request('http://x'),
        response: new Response(),
      }),
    }

    const client = experimental_toSilgiClient(sdk)
    await client.planetList({ headers: { 'x-something': 'value' } }, { lastEventId: '456' })

    expect(sdk.planetList).toHaveBeenCalledWith({
      signal: expect.any(AbortSignal),
      headers: {
        'x-something': 'value',
        'last-event-id': '456',
      },
      throwOnError: true,
    })
  })

  describe('abort signal', () => {
    it('forwards abort from input signal', async () => {
      const controller = new AbortController()
      let capturedSignal: AbortSignal | undefined

      const sdk = {
        doSomething: vi.fn().mockImplementation((opts) => {
          capturedSignal = opts.signal
          return Promise.resolve({ data: 'ok', request: new Request('http://x'), response: new Response() })
        }),
      }

      const client = experimental_toSilgiClient(sdk)
      await client.doSomething({ signal: controller.signal })

      expect(capturedSignal!.aborted).toBe(false)
      controller.abort()
      expect(capturedSignal!.aborted).toBe(true)
    })

    it('forwards abort from options signal', async () => {
      const controller = new AbortController()
      let capturedSignal: AbortSignal | undefined

      const sdk = {
        doSomething: vi.fn().mockImplementation((opts) => {
          capturedSignal = opts.signal
          return Promise.resolve({ data: 'ok', request: new Request('http://x'), response: new Response() })
        }),
      }

      const client = experimental_toSilgiClient(sdk)
      await client.doSomething({}, { signal: controller.signal })

      expect(capturedSignal!.aborted).toBe(false)
      controller.abort()
      expect(capturedSignal!.aborted).toBe(true)
    })

    it('aborts immediately if input signal already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const sdk = {
        doSomething: vi.fn().mockImplementation((opts) => {
          expect(opts.signal.aborted).toBe(true)
          return Promise.resolve({ data: 'ok', request: new Request('http://x'), response: new Response() })
        }),
      }

      const client = experimental_toSilgiClient(sdk)
      await client.doSomething({ signal: controller.signal })

      expect(sdk.doSomething).toHaveBeenCalledTimes(1)
    })

    it('aborts immediately if options signal already aborted', async () => {
      const controller = new AbortController()
      controller.abort()

      const sdk = {
        doSomething: vi.fn().mockImplementation((opts) => {
          expect(opts.signal.aborted).toBe(true)
          return Promise.resolve({ data: 'ok', request: new Request('http://x'), response: new Response() })
        }),
      }

      const client = experimental_toSilgiClient(sdk)
      await client.doSomething({}, { signal: controller.signal })

      expect(sdk.doSomething).toHaveBeenCalledTimes(1)
    })
  })

  it('throws on error', async () => {
    const sdk = {
      planetList: vi.fn().mockRejectedValue(new Error('Internal Server Error')),
    }

    const client = experimental_toSilgiClient(sdk)
    await expect(client.planetList()).rejects.toThrow('Internal Server Error')
  })
})
