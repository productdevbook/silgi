import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createSchemaRegistry, schemaToJsonSchema } from '#src/core/schema-converter.ts'
import { zodConverter } from '#src/integrations/zod/index.ts'

describe('schema-converter registry (explicit injection)', () => {
  it('returns an open schema when no registry is passed and no native fast path', () => {
    const fake: any = {
      '~standard': { vendor: 'nonexistent-vendor-xyz', version: 1, validate: () => ({ value: null }) },
    }
    expect(schemaToJsonSchema(fake)).toEqual({})
  })

  it('dispatches via vendor tag when a converter is in the registry', () => {
    const fake: any = {
      '~standard': { vendor: 'test-vendor-dispatch', version: 1, validate: () => ({ value: null }) },
    }
    const registry = createSchemaRegistry([
      {
        vendor: 'test-vendor-dispatch',
        toJsonSchema: () => ({ type: 'string', 'x-marker': 'custom' }),
      },
    ])

    const result = schemaToJsonSchema(fake, 'input', registry)
    expect(result.type).toBe('string')
    expect((result as any)['x-marker']).toBe('custom')
  })

  it("prefers the schema's native jsonSchema.input() over a registry converter", () => {
    const withNative: any = {
      '~standard': {
        vendor: 'test-vendor-native',
        version: 1,
        validate: () => ({ value: null }),
        jsonSchema: { input: () => ({ type: 'number', 'x-source': 'native' }) },
      },
    }
    const registry = createSchemaRegistry([
      {
        vendor: 'test-vendor-native',
        toJsonSchema: () => ({ type: 'string', 'x-source': 'registry' }),
      },
    ])
    const out = schemaToJsonSchema(withNative, 'input', registry)
    expect(out.type).toBe('number')
    expect((out as any)['x-source']).toBe('native')
  })

  it('zodConverter declares vendor "zod"', () => {
    expect(zodConverter.vendor).toBe('zod')
  })

  it('createSchemaRegistry + zodConverter enables Zod schema conversion', () => {
    const registry = createSchemaRegistry([zodConverter])
    const schema = z.object({ name: z.string() })
    const noFast: any = {
      '~standard': { ...schema['~standard'], jsonSchema: undefined },
      _zod: (schema as any)._zod,
    }
    const out = schemaToJsonSchema(noFast, 'input', registry)
    expect(out.type).toBe('object')
    expect(out.properties).toBeDefined()
    expect(out.properties!.name!.type).toBe('string')
  })

  it('emits console.warn once per unknown vendor when an empty registry is provided', () => {
    const registry = createSchemaRegistry([])
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake: any = {
      '~standard': { vendor: 'warn-test-vendor-unique', version: 1, validate: () => ({ value: null }) },
    }
    schemaToJsonSchema(fake, 'input', registry)
    schemaToJsonSchema(fake, 'input', registry)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toContain('warn-test-vendor-unique')
    spy.mockRestore()
  })

  it('does not emit console.warn when no registry is passed', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fake: any = {
      '~standard': { vendor: 'no-registry-vendor', version: 1, validate: () => ({ value: null }) },
    }
    schemaToJsonSchema(fake, 'input')
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
