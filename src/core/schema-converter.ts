/**
 * Schema converter registry — decouples OpenAPI/analytics JSON-Schema
 * generation from any specific Standard Schema validator.
 *
 * Core does not depend on Zod (or any other validator). Validator-specific
 * integrations (e.g. `silgi/zod`) register themselves at import time; core
 * looks them up by `schema['~standard'].vendor`.
 *
 * Fast path for any Standard Schema implementation exposing `jsonSchema.input`
 * is handled by `schemaToJsonSchema` directly, so validators with native JSON
 * Schema support (Valibot, ArkType, …) work without registering anything.
 */

import type { AnySchema } from './schema.ts'

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

export interface ConvertOptions {
  strategy: 'input' | 'output'
}

export interface SchemaConverter {
  toJsonSchema(schema: AnySchema, opts: ConvertOptions): JSONSchema
}

const registry = new Map<string, SchemaConverter>()

/** Register a converter for a Standard Schema vendor (e.g. "zod"). */
export function registerSchemaConverter(vendor: string, converter: SchemaConverter): void {
  registry.set(vendor, converter)
}

/** Look up a converter by the schema's Standard Schema vendor tag. */
export function getSchemaConverter(schema: AnySchema): SchemaConverter | undefined {
  const vendor = (schema as any)?.['~standard']?.vendor
  return typeof vendor === 'string' ? registry.get(vendor) : undefined
}

/**
 * Convert any Standard Schema to JSON Schema. Uses the schema's own
 * `jsonSchema.input()` when available; otherwise falls back to a registered
 * vendor converter; otherwise returns an open schema `{}`.
 */
export function schemaToJsonSchema(schema: AnySchema, strategy: 'input' | 'output' = 'input'): JSONSchema {
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

  const converter = getSchemaConverter(schema)
  if (converter) {
    try {
      return converter.toJsonSchema(schema, { strategy })
    } catch {}
  }

  return {}
}
