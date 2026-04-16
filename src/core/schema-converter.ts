/**
 * Schema converter — explicit injection model.
 *
 * @remarks
 * Core is validator-agnostic. Converters are passed explicitly via
 * `silgi({ schemaConverters: [zodConverter] })`; there is no module-scoped
 * or global registry. The `silgi()` factory builds a per-instance
 * `SchemaRegistry` and threads it through the handler pipeline to
 * `wrapWithScalar` / `wrapWithAnalytics`.
 *
 * Resolution order used by {@link schemaToJsonSchema}:
 * 1. **Native fast path** — `schema['~standard'].jsonSchema.input()`
 *    (Valibot, ArkType, Zod v4, …). No registry needed.
 * 2. **Registry lookup** — finds a converter by `schema['~standard'].vendor`.
 * 3. **Empty schema `{}`** — emits a one-time `console.warn` per vendor
 *    when a registry was provided but contained no matching converter.
 *
 * @example
 * ```ts
 * import { zodConverter } from 'silgi/zod'
 * import { silgi } from 'silgi'
 *
 * const k = silgi({
 *   context: (req) => ({}),
 *   schemaConverters: [zodConverter],
 * })
 * ```
 *
 * @category Schema
 */

import type { AnySchema } from './schema.ts'

/**
 * JSON Schema subset used for OpenAPI / analytics output.
 *
 * @category Schema
 */
export interface JSONSchema {
  type?: string | string[]
  format?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  anyOf?: JSONSchema[]
  oneOf?: JSONSchema[]
  allOf?: JSONSchema[]
  enum?: unknown[]
  const?: unknown
  description?: string
  title?: string
  default?: unknown
  [key: string]: unknown
}

/**
 * Options passed to a converter's `toJsonSchema` method.
 *
 * @category Schema
 */
export interface ConvertOptions {
  strategy: 'input' | 'output'
}

/**
 * A converter that translates a specific Standard Schema vendor's schemas
 * into JSON Schema. Pass instances via `silgi({ schemaConverters: [...] })`.
 *
 * @remarks
 * Implement this interface to add OpenAPI / analytics support for a custom
 * schema library. The `vendor` string must match the `~standard.vendor`
 * property reported by the schema library's Standard Schema implementation.
 *
 * @example
 * ```ts
 * import type { SchemaConverter } from 'silgi'
 *
 * const myConverter: SchemaConverter = {
 *   vendor: 'my-lib',
 *   toJsonSchema(schema, opts) {
 *     return { type: 'string' }
 *   },
 * }
 * ```
 *
 * @category Schema
 */
export interface SchemaConverter {
  /** The Standard Schema `~standard.vendor` string this converter handles (e.g. `"zod"`). */
  vendor: string
  /**
   * Convert a schema to a JSON Schema object.
   *
   * @param schema - The schema to convert.
   * @param opts - Conversion options including `strategy` (`'input'` | `'output'`).
   * @returns A JSON Schema object. Return `{}` for unsupported/unknown schemas.
   */
  toJsonSchema(schema: AnySchema, opts: ConvertOptions): JSONSchema
}

/**
 * A per-instance registry mapping vendor strings to their converters.
 *
 * Built by {@link createSchemaRegistry} and threaded through the handler
 * pipeline to scalar and analytics wrappers.
 *
 * @category Schema
 */
export type SchemaRegistry = Map<string, SchemaConverter>

/**
 * Build a {@link SchemaRegistry} from an array of converters.
 *
 * @param converters - Array of {@link SchemaConverter} objects, each
 *   declaring their own `vendor`.
 * @returns A `Map<string, SchemaConverter>` keyed by `converter.vendor`.
 *
 * @example
 * ```ts
 * import { zodConverter } from 'silgi/zod'
 * import { createSchemaRegistry } from 'silgi'
 *
 * const registry = createSchemaRegistry([zodConverter])
 * ```
 *
 * @category Schema
 */
export function createSchemaRegistry(converters: SchemaConverter[] = []): SchemaRegistry {
  const map = new Map<string, SchemaConverter>()
  for (const converter of converters) {
    map.set(converter.vendor, converter)
  }
  return map
}

// Module-scoped Set holds only vendor-name strings (write-once for warn
// de-duplication). No schema data, no user input — safe to keep.
const _warnedVendors = new Set<string>()

/**
 * Convert any Standard Schema to JSON Schema.
 *
 * @remarks
 * Resolution order:
 * 1. **Native fast path** — `schema['~standard'].jsonSchema.input()`
 *    (Valibot, ArkType, Zod v4, …). No registry needed.
 * 2. **Registry lookup** — finds a converter by
 *    `schema['~standard'].vendor`. Registry must be passed explicitly;
 *    there is no global mutable state.
 * 3. **Empty schema `{}`** — emits a one-time `console.warn` per vendor
 *    when a registry was provided but contained no matching converter.
 *    No warn when no registry was passed (caller opted out).
 *
 * @param schema - Any Standard Schema compatible schema object.
 * @param strategy - `'input'` (default) for pre-transform types; `'output'`
 *   for post-transform.
 * @param registry - Optional {@link SchemaRegistry} built from
 *   {@link createSchemaRegistry}. When omitted the function still handles
 *   schemas that expose the native `jsonSchema.input()` fast path.
 * @returns A JSON Schema object. Returns `{}` when conversion is not possible.
 *
 * @example
 * ```ts
 * import { zodConverter } from 'silgi/zod'
 * import { createSchemaRegistry, schemaToJsonSchema } from 'silgi'
 * import { z } from 'zod'
 *
 * const registry = createSchemaRegistry([zodConverter])
 * const json = schemaToJsonSchema(z.object({ name: z.string() }), 'input', registry)
 * ```
 *
 * @category Schema
 */
export function schemaToJsonSchema(
  schema: AnySchema,
  strategy: 'input' | 'output' = 'input',
  registry?: SchemaRegistry,
): JSONSchema {
  const std = (schema as any)?.['~standard']

  if (std?.jsonSchema?.input) {
    try {
      const result = std.jsonSchema.input({ target: 'draft-2020-12' })
      if (result && typeof result === 'object') {
        const { $schema: _, ...rest } = result as Record<string, unknown>
        return rest as JSONSchema
      }
    } catch {}
  }

  const vendor = typeof std?.vendor === 'string' ? std.vendor : undefined
  if (vendor && registry) {
    const converter = registry.get(vendor)
    if (converter) {
      try {
        return converter.toJsonSchema(schema, { strategy })
      } catch {}
    } else if (!_warnedVendors.has(vendor)) {
      _warnedVendors.add(vendor)
      console.warn(
        `[silgi] No schema converter registered for vendor "${vendor}". ` +
          `Pass schemaConverters: [${vendor}Converter] to silgi() to enable OpenAPI / analytics schema generation.`,
      )
    }
  }

  return {}
}
