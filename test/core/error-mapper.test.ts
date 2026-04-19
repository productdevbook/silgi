/**
 * mapDomainErrors — service-layer error translation for resolvers.
 */

import { describe, it, expect } from 'vitest'

import { SilgiError, isSilgiError } from '#src/core/error.ts'
import { mapDomainErrors } from '#src/error-mapper.ts'
import { silgi } from '#src/silgi.ts'

class DomainError extends Error {
  constructor(
    public code: string,
    public status: number,
    message: string,
    public info?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

describe('mapDomainErrors', () => {
  const handle = mapDomainErrors((e) => {
    if (e instanceof DomainError) {
      return new SilgiError(e.code, {
        status: e.status,
        message: e.message,
        data: e.info,
        defined: true,
      })
    }
  })

  it('passes through return value when no error', async () => {
    const fn = handle(async (x: number) => x * 2)
    expect(await fn(3)).toBe(6)
  })

  it('maps DomainError to SilgiError with status + defined flag', async () => {
    const fn = handle(async () => {
      throw new DomainError('NOT_FOUND', 404, 'missing')
    })
    await expect(fn()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
      message: 'missing',
      defined: true,
    })
  })

  it('rethrows SilgiError unchanged (mapper not called for them)', async () => {
    let called = false
    const wrap = mapDomainErrors((_e) => {
      called = true
      return new SilgiError('BAD_REQUEST')
    })
    const silgiErr = new SilgiError('CONFLICT', { status: 409, defined: true })
    const fn = wrap(async () => {
      throw silgiErr
    })
    await expect(fn()).rejects.toBe(silgiErr)
    expect(called).toBe(false)
  })

  it('rethrows original error when mapper returns undefined', async () => {
    const weird = new Error('boom')
    const fn = handle(async () => {
      throw weird
    })
    await expect(fn()).rejects.toBe(weird)
  })

  it('integrates with silgi resolvers', async () => {
    const k = silgi({ context: () => ({}) })
    const proc = k.$errors({ NOT_FOUND: 404 }).$resolve(
      handle(async () => {
        throw new DomainError('NOT_FOUND', 404, 'user missing')
      }),
    )
    const caller = k.createCaller(k.router({ get: proc }))
    try {
      await caller.get()
      throw new Error('expected rejection')
    } catch (e) {
      expect(isSilgiError(e)).toBe(true)
      expect((e as SilgiError).code).toBe('NOT_FOUND')
      expect((e as SilgiError).status).toBe(404)
    }
  })
})
