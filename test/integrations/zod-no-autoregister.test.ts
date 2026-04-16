import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { schemaToJsonSchema } from '#src/core/schema-converter.ts'

describe('silgi/zod — no auto-registration side effect', () => {
  it('importing zodConverter does not register globally', async () => {
    const { zodConverter } = await import('#src/integrations/zod/index.ts')

    expect(zodConverter.vendor).toBe('zod')

    const schema = z.object({ name: z.string() })
    const noFast: any = {
      '~standard': { ...schema['~standard'], jsonSchema: undefined },
      _zod: (schema as any)._zod,
    }

    const result = schemaToJsonSchema(noFast, 'input')
    expect(result).toEqual({})
  })

  it('passes zodConverter via createSchemaRegistry to enable conversion', async () => {
    const { zodConverter } = await import('#src/integrations/zod/index.ts')
    const { createSchemaRegistry } = await import('#src/core/schema-converter.ts')

    const registry = createSchemaRegistry([zodConverter])
    const schema = z.object({ name: z.string() })
    const noFast: any = {
      '~standard': { ...schema['~standard'], jsonSchema: undefined },
      _zod: (schema as any)._zod,
    }

    const result = schemaToJsonSchema(noFast, 'input', registry)
    expect(result.type).toBe('object')
    expect(result.properties!.name!.type).toBe('string')
  })
})
