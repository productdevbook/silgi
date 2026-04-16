/**
 * Zod integration for Silgi — explicit injection model.
 *
 * @remarks
 * **Breaking change:** the old side-effect import (`import 'silgi/zod'`)
 * that auto-registered the Zod converter globally is removed. Import
 * {@link zodConverter} and pass it explicitly to
 * `silgi({ schemaConverters: [zodConverter] })`.
 *
 * Migration:
 * ```ts
 * // Before:
 * import 'silgi/zod'
 * const k = silgi({ context: ... })
 *
 * // After:
 * import { zodConverter } from 'silgi/zod'
 * const k = silgi({ context: ..., schemaConverters: [zodConverter] })
 * ```
 *
 * Note: Zod v4 schemas expose a native `jsonSchema.input()` fast path, so
 * most Zod v4 users do not strictly need this converter. Passing
 * `zodConverter` is still recommended as a safety net for schemas that
 * bypass the fast path.
 *
 * @category Schema
 */

import { ZodSchemaConverter } from './converter.ts'

import type { SchemaConverter } from '../../core/schema-converter.ts'

export { ZodSchemaConverter, CompositeSchemaConverter } from './converter.ts'
export type { JSONSchema, ConvertOptions } from './converter.ts'
export type { SchemaConverter } from '../../core/schema-converter.ts'

const _zodConverterInstance = new ZodSchemaConverter()

/**
 * Pre-built Zod → JSON Schema converter for use with
 * `silgi({ schemaConverters })`.
 *
 * @remarks
 * Pass this to the `schemaConverters` option of `silgi()` to enable
 * OpenAPI spec generation and analytics schema extraction for Zod
 * schemas. Supports Zod v3 and v4.
 *
 * @example
 * ```ts
 * import { zodConverter } from 'silgi/zod'
 * import { silgi } from 'silgi'
 *
 * const k = silgi({
 *   context: (req) => ({ db: getDB() }),
 *   schemaConverters: [zodConverter],
 * })
 * ```
 *
 * @category Schema
 */
export const zodConverter: SchemaConverter = {
  vendor: 'zod',
  toJsonSchema(schema, opts) {
    const [, json] = _zodConverterInstance.convert(schema, opts)
    return json
  },
}
