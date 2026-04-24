import { describe, expect, it, vi } from 'vitest'

import { compileProcedure } from '#src/compile.ts'
import { SilgiError } from '#src/core/error.ts'
import { SchemaValidatorCrash, validateSchema } from '#src/core/schema.ts'
import { silgi } from '#src/silgi.ts'

import type { AnySchema } from '#src/core/schema.ts'

const k = silgi({ context: () => ({}) })

function syncCrashSchema(message = 'boom'): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate() {
        throw new TypeError(message)
      },
    },
  } as AnySchema
}

function asyncCrashSchema(message = 'async-boom'): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate() {
        return Promise.reject(new TypeError(message))
      },
    },
  } as AnySchema
}

function passthroughSchema(): AnySchema {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate(value: unknown) {
        return { value }
      },
    },
  } as AnySchema
}

// === validateSchema raw behaviour ===

describe('validateSchema — validator crash handling', () => {
  it('wraps a synchronous validator throw as SchemaValidatorCrash', () => {
    expect(() => validateSchema(syncCrashSchema('inner'), {})).toThrowError(SchemaValidatorCrash)
    try {
      validateSchema(syncCrashSchema('inner'), {})
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaValidatorCrash)
      expect((e as SchemaValidatorCrash).cause).toBeInstanceOf(TypeError)
      expect(((e as SchemaValidatorCrash).cause as Error).message).toBe('inner')
    }
  })

  it('wraps an async validator rejection as SchemaValidatorCrash', async () => {
    const result = validateSchema(asyncCrashSchema('async-inner'), {})
    expect(result).toBeInstanceOf(Promise)
    await expect(result as Promise<unknown>).rejects.toBeInstanceOf(SchemaValidatorCrash)
    try {
      await (result as Promise<unknown>)
    } catch (e) {
      expect((e as SchemaValidatorCrash).cause).toBeInstanceOf(TypeError)
      expect(((e as SchemaValidatorCrash).cause as Error).message).toBe('async-inner')
    }
  })
})

// === compileProcedure: input vs output classification ===

describe('compileProcedure — schema crash classification', () => {
  it('classifies an input validator crash as BAD_REQUEST', async () => {
    const proc = k.$input(syncCrashSchema()).$resolve(() => 'unreachable')
    const handler = compileProcedure(proc)
    await expect(handler({}, { any: 'thing' }, AbortSignal.timeout(1000))).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    })
  })

  it('preserves the original throw as cause on input crashes', async () => {
    const proc = k.$input(syncCrashSchema('input-stack')).$resolve(() => 'unreachable')
    const handler = compileProcedure(proc)
    try {
      await handler({}, {}, AbortSignal.timeout(1000))
    } catch (e) {
      expect(e).toBeInstanceOf(SilgiError)
      const cause = (e as SilgiError).cause as Error
      expect(cause).toBeInstanceOf(TypeError)
      expect(cause.message).toBe('input-stack')
    }
  })

  it('classifies a sync output validator crash as INTERNAL_SERVER_ERROR', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const proc = k.$output(syncCrashSchema('out-stack')).$resolve(() => ({ ok: true }))
      const handler = compileProcedure(proc)
      await expect(handler({}, undefined, AbortSignal.timeout(1000))).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
      })
      // dev-mode log surfaced the underlying TypeError
      expect(errorSpy).toHaveBeenCalled()
      const args = errorSpy.mock.calls[0]!
      expect(args[1]).toBeInstanceOf(TypeError)
      expect((args[1] as Error).message).toBe('out-stack')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('classifies an async output validator crash as INTERNAL_SERVER_ERROR', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const proc = k.$output(asyncCrashSchema('async-out')).$resolve(() => ({ ok: true }))
      const handler = compileProcedure(proc)
      await expect(handler({}, undefined, AbortSignal.timeout(1000))).rejects.toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
      })
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('does not affect happy-path output validation', async () => {
    const proc = k.$output(passthroughSchema()).$resolve(() => ({ ok: true }))
    const handler = compileProcedure(proc)
    const result = await handler({}, undefined, AbortSignal.timeout(1000))
    expect(result).toEqual({ ok: true })
  })
})
