/**
 * JSON Schema → validation library code converter.
 *
 * Generic converter that delegates to a SchemaEmitter for library-specific output.
 * Supports Zod, Valibot, and ArkType via the emitter pattern.
 */

import type { SchemaEmitter, SchemaTarget } from './emitters.ts'
import { getEmitter } from './emitters.ts'

interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  additionalProperties?: boolean | JsonSchema
  allOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  not?: JsonSchema
  enum?: unknown[]
  const?: unknown
  $ref?: string
  format?: string
  pattern?: string
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number | boolean
  exclusiveMaximum?: number | boolean
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  default?: unknown
  nullable?: boolean
  description?: string
  deprecated?: boolean
  title?: string
  readOnly?: boolean
  writeOnly?: boolean
  discriminator?: { propertyName: string; mapping?: Record<string, string> }
  [key: string]: unknown
}

export interface SchemaContext {
  /** Collected component schema names that need to be emitted */
  refs: Set<string>
  /** All component schemas from the spec */
  components: Record<string, JsonSchema>
  /** Already-emitted schema names (prevents infinite recursion) */
  emitted: Set<string>
  /** Active emitter for the target library */
  emitter: SchemaEmitter
}

export function createSchemaContext(
  target: SchemaTarget,
  components: Record<string, JsonSchema> = {},
): SchemaContext {
  return {
    refs: new Set(),
    components,
    emitted: new Set(),
    emitter: getEmitter(target),
  }
}

/**
 * Convert a JSON Schema to a validation library code string.
 */
export function jsonSchemaToCode(schema: JsonSchema, ctx: SchemaContext): string {
  const e = ctx.emitter
  if (!schema || typeof schema !== 'object') return e.unknown()

  // $ref
  if (schema.$ref) {
    const refName = resolveRefName(schema.$ref)
    ctx.refs.add(refName)
    return refName + 'Schema'
  }

  // const
  if (schema.const !== undefined) {
    return e.literal(schema.const)
  }

  // enum
  if (schema.enum) {
    if (schema.enum.length === 1) {
      return e.literal(schema.enum[0])
    }
    return e.enum(schema.enum)
  }

  // allOf → intersection
  if (schema.allOf?.length) {
    if (schema.allOf.length === 1) return jsonSchemaToCode(schema.allOf[0]!, ctx)
    const parts = schema.allOf.map((s) => jsonSchemaToCode(s, ctx))
    return e.intersection(parts)
  }

  // oneOf / anyOf → union
  if (schema.oneOf?.length || schema.anyOf?.length) {
    const variants = (schema.oneOf ?? schema.anyOf)!
    if (variants.length === 1) return jsonSchemaToCode(variants[0]!, ctx)

    const members = variants.map((v) => jsonSchemaToCode(v, ctx))

    if (schema.discriminator?.propertyName) {
      return e.discriminatedUnion(schema.discriminator.propertyName, members)
    }

    return e.union(members)
  }

  // Handle type arrays like ["string", "null"]
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  const isNullable = schema.nullable || types.includes('null')
  const nonNullTypes = types.filter((t) => t !== 'null')

  // Multiple non-null types → union
  if (nonNullTypes.length > 1) {
    const members = nonNullTypes.map((t) => jsonSchemaToCode({ ...schema, type: t }, ctx))
    let result = e.union(members)
    if (isNullable) result = e.nullable(result)
    return result
  }

  const type = nonNullTypes[0] ?? (types.length === 0 ? undefined : nonNullTypes[0])

  let result: string

  switch (type) {
    case 'string':
      result = buildString(schema, e)
      break
    case 'number':
    case 'integer':
      result = buildNumber(schema, type, e)
      break
    case 'boolean':
      result = e.boolean()
      break
    case 'null':
      return e.null()
    case 'object':
      result = buildObject(schema, ctx)
      break
    case 'array':
      result = buildArray(schema, ctx)
      break
    default:
      if (schema.properties) {
        result = buildObject(schema, ctx)
      } else {
        result = e.unknown()
      }
  }

  if (isNullable && type !== 'null') result = e.nullable(result)
  if (schema.default !== undefined) result = e.default(result, schema.default)
  if (schema.description) result = e.describe(result, schema.description)

  return result
}

function buildString(schema: JsonSchema, e: SchemaEmitter): string {
  // Format-specific shortcuts
  if (schema.format === 'email') return applyStringConstraints(e.email(), schema, e)
  if (schema.format === 'uri' || schema.format === 'url') return applyStringConstraints(e.url(), schema, e)
  if (schema.format === 'uuid') return applyStringConstraints(e.uuid(), schema, e)
  if (schema.format === 'date-time') return applyStringConstraints(e.datetime(), schema, e)
  if (schema.format === 'date') return applyStringConstraints(e.date(), schema, e)
  if (schema.format === 'ipv4') return applyStringConstraints(e.ipv4(), schema, e)
  if (schema.format === 'ipv6') return applyStringConstraints(e.ipv6(), schema, e)

  return applyStringConstraints(e.string(), schema, e)
}

function applyStringConstraints(base: string, schema: JsonSchema, e: SchemaEmitter): string {
  let s = base
  if (schema.minLength != null) s = e.min(s, schema.minLength)
  if (schema.maxLength != null) s = e.max(s, schema.maxLength)
  if (schema.pattern) s = e.regex(s, schema.pattern)
  return s
}

function buildNumber(schema: JsonSchema, type: string, e: SchemaEmitter): string {
  let s = type === 'integer' ? e.int() : e.number()

  if (schema.minimum != null) s = e.min(s, schema.minimum)
  if (schema.maximum != null) s = e.max(s, schema.maximum)
  if (typeof schema.exclusiveMinimum === 'number') s = e.gt(s, schema.exclusiveMinimum)
  if (typeof schema.exclusiveMaximum === 'number') s = e.lt(s, schema.exclusiveMaximum)

  return s
}

function buildObject(schema: JsonSchema, ctx: SchemaContext): string {
  const e = ctx.emitter

  if (!schema.properties && schema.additionalProperties) {
    const valueSchema =
      typeof schema.additionalProperties === 'object'
        ? jsonSchemaToCode(schema.additionalProperties, ctx)
        : e.unknown()
    return e.record(e.string(), valueSchema)
  }

  if (!schema.properties) {
    if (schema.additionalProperties === false) return e.object([])
    return e.record(e.string(), e.unknown())
  }

  const required = new Set(schema.required ?? [])
  const entries = Object.entries(schema.properties).map(([key, prop]) => ({
    key,
    value: jsonSchemaToCode(prop, ctx),
    required: required.has(key),
  }))

  return e.object(entries)
}

function buildArray(schema: JsonSchema, ctx: SchemaContext): string {
  const e = ctx.emitter
  const items = schema.items ? jsonSchemaToCode(schema.items, ctx) : e.unknown()
  let s = e.array(items)

  if (schema.minItems != null) s = e.min(s, schema.minItems)
  if (schema.maxItems != null) s = e.max(s, schema.maxItems)

  return s
}

function resolveRefName(ref: string): string {
  const parts = ref.split('/')
  return parts[parts.length - 1]!
}

/**
 * Generate all referenced component schemas as declarations.
 * Recursively resolves nested refs.
 */
export function emitComponentSchemas(ctx: SchemaContext): string {
  const lines: string[] = []
  let toProcess = [...ctx.refs]
  while (toProcess.length > 0) {
    const next: string[] = []
    for (const name of toProcess) {
      if (ctx.emitted.has(name)) continue
      ctx.emitted.add(name)

      const schema = ctx.components[name]
      if (!schema) {
        lines.push(`// WARNING: Missing component schema "${name}"`)
        lines.push(`export const ${name}Schema = ${ctx.emitter.unknown()}`)
        continue
      }

      const code = jsonSchemaToCode(schema, ctx)
      lines.push(`export const ${name}Schema = ${code}`)

      for (const ref of ctx.refs) {
        if (!ctx.emitted.has(ref)) next.push(ref)
      }
    }
    toProcess = next
  }
  return lines.join('\n\n')
}
