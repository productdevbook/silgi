import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { getSchemaConverter, registerSchemaConverter, schemaToJsonSchema } from '#src/core/schema-converter.ts'

describe('schema-converter registry', () => {
  it('returns an open schema for an unregistered vendor', () => {
    const fake: any = {
      '~standard': { vendor: 'nonexistent-vendor-xyz', version: 1, validate: () => ({ value: null }) },
    }
    expect(schemaToJsonSchema(fake)).toEqual({})
  })

  it('dispatches via vendor tag when a converter is registered', () => {
    const fake: any = {
      '~standard': { vendor: 'test-vendor', version: 1, validate: () => ({ value: null }) },
    }
    registerSchemaConverter('test-vendor', {
      toJsonSchema: () => ({ type: 'string', 'x-marker': 'custom' }),
    })

    const result = schemaToJsonSchema(fake)
    expect(result.type).toBe('string')
    expect((result as any)['x-marker']).toBe('custom')
  })

  it("prefers the schema's native jsonSchema.input() over a registered converter", () => {
    const withNative: any = {
      '~standard': {
        vendor: 'test-vendor',
        version: 1,
        validate: () => ({ value: null }),
        jsonSchema: { input: () => ({ type: 'number', 'x-source': 'native' }) },
      },
    }
    // A registered converter should be ignored because the fast path wins.
    registerSchemaConverter('test-vendor', {
      toJsonSchema: () => ({ type: 'string', 'x-source': 'registry' }),
    })
    const out = schemaToJsonSchema(withNative)
    expect(out.type).toBe('number')
    expect((out as any)['x-source']).toBe('native')
  })

  it('getSchemaConverter reads the standard vendor tag', async () => {
    await import('#src/integrations/zod/index.ts')
    const schema = z.object({ name: z.string() })
    expect(getSchemaConverter(schema)).toBeDefined()
  })

  it('silgi/zod registers a working converter', async () => {
    await import('#src/integrations/zod/index.ts')
    // Forge a schema that advertises the zod vendor but does NOT implement the
    // native Standard Schema jsonSchema fast path, so the registry fallback runs.
    const schema = z.object({ name: z.string() })
    const noFast: any = {
      '~standard': { ...schema['~standard'], jsonSchema: undefined },
      _zod: (schema as any)._zod,
    }
    const out = schemaToJsonSchema(noFast)
    expect(out.type).toBe('object')
    expect(out.properties).toBeDefined()
    expect(out.properties!.name!.type).toBe('string')
  })
})
