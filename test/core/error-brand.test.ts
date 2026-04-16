import { createContext, runInContext } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { SilgiError, fromSilgiErrorJSON, isDefinedError, isSilgiError, toSilgiError } from '#src/core/error.ts'

const BRAND_KEY = Symbol.for('silgi.error.brand.v1')

describe('SilgiError — brand and type guards', () => {
  it('SilgiError instance passes instanceof SilgiError', () => {
    const e = new SilgiError('NOT_FOUND')
    expect(e instanceof SilgiError).toBe(true)
  })

  it('SilgiError instance passes isSilgiError()', () => {
    const e = new SilgiError('NOT_FOUND')
    expect(isSilgiError(e)).toBe(true)
  })

  it('plain Error fails instanceof SilgiError', () => {
    const e = new Error('oops')
    expect(e instanceof SilgiError).toBe(false)
  })

  it('plain Error fails isSilgiError()', () => {
    expect(isSilgiError(new Error('oops'))).toBe(false)
  })

  it('null and undefined fail isSilgiError()', () => {
    expect(isSilgiError(null)).toBe(false)
    expect(isSilgiError(undefined)).toBe(false)
  })

  it('plain object fails isSilgiError()', () => {
    expect(isSilgiError({ code: 'NOT_FOUND', status: 404 })).toBe(false)
  })

  it('primitives fail isSilgiError()', () => {
    expect(isSilgiError('NOT_FOUND')).toBe(false)
    expect(isSilgiError(404)).toBe(false)
    expect(isSilgiError(true)).toBe(false)
  })

  it('brand symbol is NOT enumerable on the instance', () => {
    const e = new SilgiError('NOT_FOUND')
    expect(Object.keys(e)).not.toContain('silgi.error.brand.v1')
    expect(Object.getOwnPropertySymbols(e)).not.toContain(BRAND_KEY)
  })

  it('brand symbol lives on the prototype, not the instance', () => {
    expect(Object.getOwnPropertySymbols(SilgiError.prototype)).toContain(BRAND_KEY)
  })

  it('JSON.stringify does not include the brand key', () => {
    const e = new SilgiError('NOT_FOUND', { data: { foo: 'bar' } })
    const json = JSON.stringify(e)
    expect(json).not.toContain('silgi.error.brand')
  })

  it('toJSON() produces exactly the five expected keys', () => {
    const e = new SilgiError('NOT_FOUND', { data: { foo: 'bar' } })
    const keys = Object.keys(e.toJSON()).sort()
    expect(keys).toEqual(['code', 'data', 'defined', 'message', 'status'])
  })
})

describe('SilgiError — subclass compatibility', () => {
  class AuthError extends SilgiError<'UNAUTHORIZED'> {
    constructor() {
      super('UNAUTHORIZED', { status: 401, message: 'Auth required' })
    }
  }

  it('user subclass passes instanceof SilgiError', () => {
    expect(new AuthError() instanceof SilgiError).toBe(true)
  })

  it('user subclass passes instanceof the subclass itself', () => {
    expect(new AuthError() instanceof AuthError).toBe(true)
  })

  it('user subclass passes isSilgiError()', () => {
    expect(isSilgiError(new AuthError())).toBe(true)
  })

  it('user subclass toJSON() does not include brand', () => {
    const e = new AuthError()
    expect(JSON.stringify(e)).not.toContain('silgi.error.brand')
  })
})

describe('SilgiError — cross-realm via node:vm', () => {
  it('instance created in vm context passes instanceof SilgiError in outer realm', () => {
    const sandbox: { SilgiError: typeof SilgiError; result?: SilgiError } = {
      SilgiError,
      result: undefined,
    }
    const ctx = createContext(sandbox)
    runInContext(`result = new SilgiError('NOT_FOUND', { status: 404 })`, ctx)
    expect(sandbox.result).toBeDefined()
    expect(sandbox.result instanceof SilgiError).toBe(true)
  })

  it('instance created in vm context passes isSilgiError() in outer realm', () => {
    const sandbox: { SilgiError: typeof SilgiError; result?: unknown } = {
      SilgiError,
      result: undefined,
    }
    const ctx = createContext(sandbox)
    runInContext(`result = new SilgiError('CONFLICT', { status: 409 })`, ctx)
    expect(isSilgiError(sandbox.result)).toBe(true)
  })

  it('Symbol.for resolves to the same symbol across realms (brand key stability)', () => {
    const ctx = createContext({})
    const innerSymbol = runInContext(`Symbol.for('silgi.error.brand.v1')`, ctx)
    expect(innerSymbol).toBe(BRAND_KEY)
  })
})

describe('fromSilgiErrorJSON / toSilgiError', () => {
  it('fromSilgiErrorJSON result passes isSilgiError()', () => {
    const e = fromSilgiErrorJSON({
      code: 'NOT_FOUND',
      status: 404,
      message: 'nope',
      data: undefined,
      defined: true,
    })
    expect(isSilgiError(e)).toBe(true)
    expect(e instanceof SilgiError).toBe(true)
  })

  it('toSilgiError wrapping a plain Error produces isSilgiError() === true', () => {
    const wrapped = toSilgiError(new Error('boom'))
    expect(isSilgiError(wrapped)).toBe(true)
    expect(wrapped.code).toBe('INTERNAL_SERVER_ERROR')
  })

  it('toSilgiError passes through an existing SilgiError by reference', () => {
    const e = new SilgiError('BAD_REQUEST')
    expect(toSilgiError(e)).toBe(e)
  })
})

describe('isDefinedError', () => {
  it('returns true for SilgiError with defined: true', () => {
    const e = new SilgiError('CONFLICT', { defined: true })
    expect(isDefinedError(e)).toBe(true)
  })

  it('returns false for SilgiError with defined: false', () => {
    const e = new SilgiError('NOT_FOUND')
    expect(isDefinedError(e)).toBe(false)
  })

  it('returns false for non-SilgiError', () => {
    expect(isDefinedError(new Error('plain'))).toBe(false)
    expect(isDefinedError(null)).toBe(false)
    expect(isDefinedError({ defined: true })).toBe(false)
  })
})
