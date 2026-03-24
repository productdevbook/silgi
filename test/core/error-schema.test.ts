import { describe, it, expect } from 'vitest'

import { SilgiError, isDefinedError, toSilgiError, isSilgiErrorJSON, fromSilgiErrorJSON } from '#src/core/error.ts'
import { AsyncIteratorClass } from '#src/core/iterator.ts'
import { validateSchema, type as typeSchema } from '#src/core/schema.ts'

// === SilgiError ===
describe('SilgiError', () => {
  it('creates with default status and message', () => {
    const err = new SilgiError('NOT_FOUND')
    expect(err.code).toBe('NOT_FOUND')
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not Found')
    expect(err.defined).toBe(false)
  })

  it('creates with custom status and message', () => {
    const err = new SilgiError('CUSTOM', { status: 418, message: "I'm a teapot" })
    expect(err.status).toBe(418)
    expect(err.message).toBe("I'm a teapot")
  })

  it('serializes to JSON', () => {
    const err = new SilgiError('BAD_REQUEST', { data: { field: 'name' }, defined: true })
    const json = err.toJSON()
    expect(json.code).toBe('BAD_REQUEST')
    expect(json.status).toBe(400)
    expect(json.data).toEqual({ field: 'name' })
    expect(json.defined).toBe(true)
  })

  it('instanceof works', () => {
    const err = new SilgiError('UNAUTHORIZED')
    expect(err instanceof SilgiError).toBe(true)
    expect(err instanceof Error).toBe(true)
  })

  it('isDefinedError works', () => {
    const defined = new SilgiError('CONFLICT', { defined: true })
    const notDefined = new SilgiError('CONFLICT', { defined: false })
    expect(isDefinedError(defined)).toBe(true)
    expect(isDefinedError(notDefined)).toBe(false)
  })

  it('toSilgiError wraps unknown errors without leaking internal message', () => {
    const err = toSilgiError(new Error('boom'))
    expect(err.code).toBe('INTERNAL_SERVER_ERROR')
    // Internal error messages must not be exposed to clients
    expect(err.message).toBe('Internal server error')
    // Original error preserved as cause for server-side logging
    expect(err.cause).toBeInstanceOf(Error)
    expect((err.cause as Error).message).toBe('boom')
  })

  it('toSilgiError passes through SilgiError', () => {
    const original = new SilgiError('NOT_FOUND')
    expect(toSilgiError(original)).toBe(original)
  })

  it('isSilgiErrorJSON validates shape', () => {
    expect(isSilgiErrorJSON({ code: 'X', status: 400, message: 'x' })).toBe(true)
    expect(isSilgiErrorJSON({ code: 123 })).toBe(false)
    expect(isSilgiErrorJSON(null)).toBe(false)
  })

  it('fromSilgiErrorJSON reconstructs', () => {
    const err = fromSilgiErrorJSON({ defined: true, code: 'CONFLICT', status: 409, message: 'dup', data: null })
    expect(err.code).toBe('CONFLICT')
    expect(err.status).toBe(409)
    expect(err.defined).toBe(true)
  })
})

// === Schema ===
describe('schema', () => {
  it('type() creates a passthrough schema', async () => {
    const schema = typeSchema<string>()
    const result = await validateSchema(schema, 'hello')
    expect(result).toBe('hello')
  })

  it('type() with mapper transforms', async () => {
    const schema = typeSchema<string, number>((s) => s.length)
    const result = await validateSchema(schema, 'hello')
    expect(result).toBe(5)
  })
})

// === AsyncIteratorClass ===
describe('AsyncIteratorClass', () => {
  it('iterates values', async () => {
    let i = 0
    const iter = new AsyncIteratorClass<number>(async () => {
      if (i >= 3) return { done: true, value: undefined as unknown as number }
      return { done: false, value: i++ }
    })

    const values: number[] = []
    for await (const v of iter) values.push(v)
    expect(values).toEqual([0, 1, 2])
  })

  it('calls cleanup on natural completion', async () => {
    let cleaned = false
    const iter = new AsyncIteratorClass<number>(
      async () => ({ done: true, value: undefined as unknown as number }),
      async () => {
        cleaned = true
      },
    )
    await iter.next()
    expect(cleaned).toBe(true)
  })

  it('calls cleanup on return()', async () => {
    let cleanupReason = ''
    const iter = new AsyncIteratorClass<number>(
      async () => ({ done: false, value: 1 }),
      async (reason) => {
        cleanupReason = reason
      },
    )
    await iter.return()
    expect(cleanupReason).toBe('return')
  })
})
