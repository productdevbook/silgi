import { registerSchemaConverter } from '../../core/schema-converter.ts'

import { ZodSchemaConverter } from './converter.ts'

export { ZodSchemaConverter, CompositeSchemaConverter } from './converter.ts'
export type { JSONSchema, ConvertOptions, SchemaConverter } from './converter.ts'

// Side-effect import: register the Zod converter with the core registry so
// Scalar/OpenAPI and analytics can convert Zod schemas to JSON Schema without
// core depending on Zod directly. Import `silgi/zod` once in app entry.
const _zodConverter = new ZodSchemaConverter()
registerSchemaConverter('zod', {
  toJsonSchema: (schema, opts) => {
    const [, json] = _zodConverter.convert(schema, opts)
    return json
  },
})
