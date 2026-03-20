/**
 * Client proxy tests — inspired by oRPC's client.test.ts patterns.
 * Tests path accumulation, signal forwarding, symbol handling, safe().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import { createClient, safe } from '#src/client/client.ts'

import type { ClientLink, ClientContext, ClientOptions } from '#src/client/types.ts'

describe('createClient proxy', () => {
  const mockedLink: ClientLink = {
    call: vi.fn().mockResolvedValue('__mocked__'),
  }

  beforeEach(() => vi.clearAllMocks())

  it('calls link with correct path and input', async () => {
    const client = createClient<any>(mockedLink)

    const result = await client.ping({ value: 'hello' })
    expect(result).toBe('__mocked__')
    expect(mockedLink.call).toHaveBeenCalledTimes(1)
    expect(mockedLink.call).toHaveBeenCalledWith(['ping'], { value: 'hello' }, expect.any(Object))
  })

  it('accumulates nested paths', async () => {
    const client = createClient<any>(mockedLink)

    await client.nested.deep.procedure({ x: 1 })
    expect(mockedLink.call).toHaveBeenCalledWith(['nested', 'deep', 'procedure'], { x: 1 }, expect.any(Object))
  })

  it('passes signal through options', async () => {
    const client = createClient<any>(mockedLink)
    const controller = new AbortController()

    await client.test('input', { signal: controller.signal })
    expect(mockedLink.call).toHaveBeenCalledWith(
      ['test'],
      'input',
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('returns undefined for Symbol properties (prevent native await)', () => {
    const client = createClient<any>(mockedLink)
    expect((client as any)[Symbol('test')]).toBeUndefined()
    expect((client as any).then).toBeUndefined()
  })

  it('caches sub-proxies', () => {
    const client = createClient<any>(mockedLink)
    const users1 = client.users
    const users2 = client.users
    expect(users1).toBe(users2) // same reference = cached
  })

  it('works without input', async () => {
    const client = createClient<any>(mockedLink)
    await client.health()
    expect(mockedLink.call).toHaveBeenCalledWith(['health'], undefined, expect.any(Object))
  })
})

describe('safe()', () => {
  it('returns data on success', async () => {
    const result = await safe(Promise.resolve(42))
    expect(result.error).toBeNull()
    expect(result.data).toBe(42)
    expect(result.isError).toBe(false)
    expect(result.isSuccess).toBe(true)
  })

  it('returns error on failure', async () => {
    const error = new Error('boom')
    const result = await safe(Promise.reject(error))
    expect(result.error).toBe(error)
    expect(result.data).toBeUndefined()
    expect(result.isError).toBe(true)
    expect(result.isSuccess).toBe(false)
  })

  it('handles typed errors', async () => {
    const { SilgiError } = await import('#src/core/error.ts')
    const err = new SilgiError('NOT_FOUND', { status: 404, message: 'nope' })
    const result = await safe<string, typeof err>(Promise.reject(err))
    expect(result.isError).toBe(true)
    expect(result.error?.code).toBe('NOT_FOUND')
  })
})
