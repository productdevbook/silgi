/**
 * Zod → JSON Schema converter.
 *
 * Converts Zod v4 schemas into JSON Schema Draft 2020-12.
 * Supports all common Zod types including transforms, pipes,
 * optionals, defaults, branded types, and more.
 *
 * Uses x-native-type extension for non-JSON types (Date, BigInt, etc.)
 */

import type { AnySchema } from '../../core/schema.ts'

export type JSONSchema = {
  type?: string | string[]
  format?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  prefixItems?: JSONSchema[]
  anyOf?: JSONSchema[]
  oneOf?: JSONSchema[]
  allOf?: JSONSchema[]
  not?: JSONSchema
  enum?: unknown[]
  const?: unknown
  $ref?: string
  description?: string
  title?: string
  default?: unknown
  examples?: unknown[]
  deprecated?: boolean
  readOnly?: boolean
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  multipleOf?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  minItems?: number
  maxItems?: number
  uniqueItems?: boolean
  minProperties?: number
  maxProperties?: number
  additionalProperties?: boolean | JSONSchema
  'x-native-type'?: string
  [key: string]: unknown
}

export interface ConvertOptions {
  /** 'input' uses pre-transform types, 'output' uses post-transform */
  strategy: 'input' | 'output'
  /** Max recursion depth before falling back to {} */
  maxDepth?: number
}

/**
 * Convert a Standard Schema to JSON Schema.
 * Returns [required, jsonSchema] tuple.
 */
export interface SchemaConverter {
  condition(schema: AnySchema): boolean
  convert(schema: AnySchema, options: ConvertOptions): [required: boolean, schema: JSONSchema]
}

/**
 * Composite converter — tries each converter in order.
 */
export class CompositeSchemaConverter {
  #converters: SchemaConverter[]

  constructor(converters: SchemaConverter[]) {
    this.#converters = converters
  }

  convert(schema: AnySchema | undefined, options: ConvertOptions): [boolean, JSONSchema] {
    if (!schema) return [false, {}]
    for (const converter of this.#converters) {
      if (converter.condition(schema)) {
        return converter.convert(schema, options)
      }
    }
    return [false, {}]
  }
}

/**
 * Zod v4 → JSON Schema converter.
 */
export class ZodSchemaConverter implements SchemaConverter {
  #maxDepth: number

  constructor(options?: { maxDepth?: number }) {
    this.#maxDepth = options?.maxDepth ?? 10
  }

  condition(schema: AnySchema): boolean {
    return schema['~standard']?.vendor === 'zod'
  }

  convert(schema: AnySchema, options: ConvertOptions): [boolean, JSONSchema] {
    return this.#convert(schema as any, options, 0)
  }

  #convert(schema: any, options: ConvertOptions, depth: number): [boolean, JSONSchema] {
    if (depth > this.#maxDepth) return [true, {}]

    // Zod v4: schema._zod.def, Zod v3: schema._def
    const zod = schema._zod
    const def = zod?.def ?? schema._def
    const bag = zod?.bag
    if (!def) return [true, {}]

    const typeName = def.type ?? def.typeName

    switch (typeName) {
      // Primitives
      case 'string':
      case 'ZodString':
        return [true, this.#convertString(def, bag)]

      case 'number':
      case 'ZodNumber': {
        const result = this.#convertNumber(def, bag)
        // Check if int format (Zod v4 uses format: "safeint" for .int())
        if (bag?.format === 'safeint' || this.#hasIntCheck(def)) {
          result.type = 'integer'
        }
        return [true, result]
      }

      case 'int':
        return [true, { ...this.#convertNumber(def, bag), type: 'integer' }]

      case 'boolean':
      case 'ZodBoolean':
        return [true, { type: 'boolean' }]

      case 'bigint':
      case 'ZodBigInt':
        return [true, { type: 'string', pattern: '^-?[0-9]+$', 'x-native-type': 'bigint' }]

      case 'date':
      case 'ZodDate':
        return [true, { type: 'string', format: 'date-time', 'x-native-type': 'date' }]

      case 'symbol':
      case 'ZodSymbol':
        return [true, {}] // Not representable in JSON Schema

      case 'undefined':
      case 'ZodUndefined':
        return [false, { not: {} }]

      case 'null':
      case 'ZodNull':
        return [true, { type: 'null' }]

      case 'void':
      case 'ZodVoid':
        return [false, { type: 'null' }]

      case 'any':
      case 'ZodAny':
        return [true, {}]

      case 'unknown':
      case 'ZodUnknown':
        return [true, {}]

      case 'never':
      case 'ZodNever':
        return [true, { not: {} }]

      case 'nan':
      case 'ZodNaN':
        return options.strategy === 'input' ? [true, { not: {} }] : [true, { type: 'null' }]

      // Composites
      case 'literal':
      case 'ZodLiteral': {
        // Zod v4: def.values is an array; Zod v3: def.value is a single value
        const values = def.values ?? [def.value]
        return [true, values.length === 1 ? { const: values[0] } : { enum: values }]
      }

      case 'enum':
      case 'ZodEnum': {
        // Zod v4: def.entries is { key: value } object; Zod v3: def.values is array
        const entries = def.entries
        const values = Array.isArray(def.values) ? def.values : entries ? Object.values(entries) : []
        return [true, { enum: values }]
      }

      case 'nativeEnum':
      case 'ZodNativeEnum':
        return [true, { enum: Object.values(def.values ?? def.entries) }]

      case 'array':
      case 'ZodArray': {
        const inner = def.element ?? def.type
        if (!inner) return [true, { type: 'array' }]
        const [, itemSchema] = this.#convert(inner, options, depth + 1)
        const result: JSONSchema = { type: 'array', items: itemSchema }
        // Zod v4: bag.minimum/maximum for array length
        if (bag?.minimum != null) result.minItems = bag.minimum
        if (bag?.maximum != null) result.maxItems = bag.maximum
        // Zod v3: def.minLength/maxLength
        if (def.minLength != null) result.minItems ??= def.minLength.value ?? def.minLength
        if (def.maxLength != null) result.maxItems ??= def.maxLength.value ?? def.maxLength
        return [true, result]
      }

      case 'object':
      case 'ZodObject': {
        const shape = def.shape ?? (typeof schema.shape === 'function' ? schema.shape() : schema.shape)
        if (!shape) return [true, { type: 'object' }]
        const properties: Record<string, JSONSchema> = {}
        const required: string[] = []
        for (const [key, value] of Object.entries(shape)) {
          const [isRequired, propSchema] = this.#convert(value as any, options, depth + 1)
          properties[key] = propSchema
          if (isRequired) required.push(key)
        }
        const result: JSONSchema = { type: 'object', properties }
        if (required.length > 0) result.required = required
        // additionalProperties
        if (def.catchall) {
          const [, catchSchema] = this.#convert(def.catchall, options, depth + 1)
          result.additionalProperties = catchSchema
        } else if (def.unknownKeys === 'strict') {
          result.additionalProperties = false
        }
        return [true, result]
      }

      case 'union':
      case 'ZodUnion':
      case 'ZodDiscriminatedUnion': {
        const unionOptions = def.options ?? def.members
        if (!Array.isArray(unionOptions)) return [true, {}]
        const schemas = unionOptions.map((o: any) => this.#convert(o, options, depth + 1))
        return [true, { anyOf: schemas.map(([, s]: any) => s) }]
      }

      case 'intersection':
      case 'ZodIntersection': {
        const [, left] = this.#convert(def.left, options, depth + 1)
        const [, right] = this.#convert(def.right, options, depth + 1)
        return [true, { allOf: [left, right] }]
      }

      case 'tuple':
      case 'ZodTuple': {
        const items = (def.items ?? def.types ?? []).map((t: any) => this.#convert(t, options, depth + 1)[1])
        const result: JSONSchema = { type: 'array', prefixItems: items }
        if (def.rest) {
          result.items = this.#convert(def.rest, options, depth + 1)[1]
        }
        return [true, result]
      }

      case 'record':
      case 'ZodRecord': {
        const [, valSchema] = this.#convert(def.valueType ?? def.element, options, depth + 1)
        return [true, { type: 'object', additionalProperties: valSchema }]
      }

      case 'map':
      case 'ZodMap': {
        const [, keySchema] = this.#convert(def.keyType, options, depth + 1)
        const [, valSchema] = this.#convert(def.valueType, options, depth + 1)
        return [
          true,
          {
            type: 'array',
            items: { type: 'array', prefixItems: [keySchema, valSchema] },
            'x-native-type': 'map',
          },
        ]
      }

      case 'set':
      case 'ZodSet': {
        const [, itemSchema] = this.#convert(def.valueType ?? def.element, options, depth + 1)
        return [true, { type: 'array', items: itemSchema, uniqueItems: true, 'x-native-type': 'set' }]
      }

      // Wrappers
      case 'optional':
      case 'ZodOptional': {
        const inner = def.innerType ?? def.wrapped
        const [, innerSchema] = this.#convert(inner, options, depth + 1)
        return [false, innerSchema]
      }

      case 'nullable':
      case 'ZodNullable': {
        const inner = def.innerType ?? def.wrapped
        const [req, innerSchema] = this.#convert(inner, options, depth + 1)
        return [req, { anyOf: [innerSchema, { type: 'null' }] }]
      }

      case 'default':
      case 'ZodDefault': {
        const inner = def.innerType ?? def.wrapped
        const [, innerSchema] = this.#convert(inner, options, depth + 1)
        const defaultValue = typeof def.defaultValue === 'function' ? def.defaultValue() : def.defaultValue
        return [false, { ...innerSchema, default: defaultValue }]
      }

      case 'readonly':
      case 'ZodReadonly': {
        const inner = def.innerType ?? def.wrapped
        const [req, innerSchema] = this.#convert(inner, options, depth + 1)
        return [req, { ...innerSchema, readOnly: true }]
      }

      case 'catch':
      case 'ZodCatch': {
        const inner = def.innerType ?? def.wrapped
        return this.#convert(inner, options, depth + 1)
      }

      case 'brand':
      case 'ZodBranded': {
        const inner = def.type ?? def.wrapped
        return this.#convert(inner, options, depth + 1)
      }

      case 'lazy':
      case 'ZodLazy': {
        const getter = def.getter ?? def.get
        if (typeof getter === 'function') {
          return this.#convert(getter(), options, depth + 1)
        }
        return [true, {}]
      }

      case 'promise':
      case 'ZodPromise': {
        const inner = def.type ?? def.wrapped
        return this.#convert(inner, options, depth + 1)
      }

      case 'transform':
      case 'ZodEffects': {
        // For transforms: input strategy uses the input type, output is unknowable
        const inner = def.schema ?? def.in ?? def.wrapped
        if (!inner) return [true, {}]
        if (options.strategy === 'input') {
          return this.#convert(inner, options, depth + 1)
        }
        return [true, {}] // Output type is unknowable
      }

      case 'pipe':
      case 'ZodPipeline': {
        if (options.strategy === 'input') {
          return this.#convert(def.in ?? def.from, options, depth + 1)
        }
        return this.#convert(def.out ?? def.to, options, depth + 1)
      }

      default:
        return [true, {}]
    }
  }

  #convertString(def: any, bag?: any): JSONSchema {
    const result: JSONSchema = { type: 'string' }
    const checks = def.checks ?? []
    bag = bag ?? {}

    // Zod v4 uses bag.minimum/maximum for string length
    if (bag.minimum != null) result.minLength = bag.minimum
    if (bag.maximum != null) result.maxLength = bag.maximum
    if (bag.patterns) {
      const patterns = Object.values(bag.patterns) as any[]
      if (patterns.length > 0) {
        result.pattern = patterns[0]?.source ?? String(patterns[0])
      }
    }
    if (bag.format) result.format = this.#normalizeFormat(bag.format)

    for (const check of checks) {
      switch (check.kind ?? check.type) {
        case 'min':
          result.minLength = check.value
          break
        case 'max':
          result.maxLength = check.value
          break
        case 'length':
          result.minLength = check.value
          result.maxLength = check.value
          break
        case 'email':
          result.format = 'email'
          break
        case 'url':
          result.format = 'uri'
          break
        case 'uuid':
          result.format = 'uuid'
          break
        case 'regex':
          result.pattern = check.regex?.source ?? check.value
          break
        case 'datetime':
          result.format = 'date-time'
          break
        case 'date':
          result.format = 'date'
          break
        case 'time':
          result.format = 'time'
          break
        case 'ip':
          result.format = check.version === 'v6' ? 'ipv6' : 'ipv4'
          break
      }
    }

    if (def.description) result.description = def.description
    return result
  }

  #hasIntCheck(def: any): boolean {
    const checks = def.checks ?? []
    return checks.some(
      (c: any) =>
        (c.kind ?? c.type ?? c._zod?.def?.check) === 'int' || c.isInt === true || c._zod?.def?.format === 'safeint',
    )
  }

  #convertNumber(def: any, bag?: any): JSONSchema {
    const result: JSONSchema = { type: 'number' }
    const checks = def.checks ?? []
    bag = bag ?? {}

    // Zod v4: bag.minimum/maximum (may be overridden by .int() safeint bounds)
    if (bag.minimum != null) result.minimum = bag.minimum
    if (bag.maximum != null) result.maximum = bag.maximum
    if (bag.multipleOf != null) result.multipleOf = bag.multipleOf

    for (const check of checks) {
      switch (check.kind ?? check.type) {
        case 'min':
          result.minimum = check.value
          break
        case 'max':
          result.maximum = check.value
          break
        case 'int':
          result.type = 'integer'
          break
        case 'multipleOf':
          result.multipleOf = check.value
          break
        case 'finite':
          break // JSON numbers are always finite
        case 'nonnegative':
          result.minimum = 0
          break
        case 'nonpositive':
          result.maximum = 0
          break
        case 'positive':
          result.exclusiveMinimum = 0
          break
        case 'negative':
          result.exclusiveMaximum = 0
          break
      }
    }

    if (def.description) result.description = def.description
    return result
  }

  #normalizeFormat(format: string): string {
    const map: Record<string, string> = {
      guid: 'uuid',
      url: 'uri',
    }
    return map[format] ?? format
  }
}
