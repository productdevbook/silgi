/**
 * Scalar API Reference — v2 OpenAPI integration.
 *
 * Generates OpenAPI 3.1.0 spec from v2 RouterDef and serves
 * Scalar UI at /reference + spec at /openapi.json.
 */

import type { AnySchema } from './core/schema.ts'
import type { ProcedureDef, RouterDef, ErrorDefItem, Route } from './types.ts'

// ── OpenAPI Spec Generation ─────────────────────────

export interface ScalarOptions {
  title?: string
  version?: string
  description?: string
  servers?: { url: string; description?: string }[]
  /** Security scheme (e.g. Bearer token) */
  security?: {
    type: 'http' | 'apiKey'
    scheme?: string // "bearer" for http
    bearerFormat?: string // "JWT"
    in?: 'header' | 'query' // for apiKey
    name?: string // header name for apiKey
    description?: string
  }
  /** Contact info */
  contact?: { name?: string; url?: string; email?: string }
  /** License */
  license?: { name: string; url?: string }
  /** External docs */
  externalDocs?: { url: string; description?: string }
  /**
   * Scalar UI script source.
   *
   * - `'cdn'` (default) — loads from cdn.jsdelivr.net
   * - `'unpkg'` — loads from unpkg.com
   * - `'local'` — serves from node_modules (offline, requires `@scalar/api-reference` installed)
   * - Custom URL string — self-hosted or local path (e.g. `'/assets/scalar.js'`)
   */
  cdn?: 'cdn' | 'unpkg' | 'local' | (string & {})
}

interface JSONSchema {
  type?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  anyOf?: JSONSchema[]
  oneOf?: JSONSchema[]
  enum?: unknown[]
  const?: unknown
  description?: string
  title?: string
  default?: unknown
  format?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  nullable?: boolean
  examples?: unknown[]
  deprecated?: boolean
  readOnly?: boolean
  writeOnly?: boolean
  [key: string]: unknown
}

/**
 * Generate OpenAPI 3.1.0 document from a v2 RouterDef.
 */
export function generateOpenAPI(router: RouterDef, options: ScalarOptions = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Map<string, { description?: string }>()

  collectProcedures(router, [], (path, proc) => {
    const route = proc.route as Route | null
    const httpPath = route?.path ?? '/' + path.join('/')
    const method = route?.method?.toLowerCase() ?? (proc.type === 'query' ? 'get' : 'post')
    const operationId = path.join('_')

    // Collect tags from first path segment
    if (path.length > 1) {
      const tagName = path[0]!
      if (!tags.has(tagName)) {
        tags.set(tagName, {})
      }
    }

    const operation: Record<string, unknown> = {
      operationId,
      tags: path.length > 1 ? [path[0]] : undefined,
      summary: route?.summary,
      description: route?.description,
      deprecated: route?.deprecated || undefined,
      responses: {},
    }

    // Remove undefined fields
    if (!operation.summary) delete operation.summary
    if (!operation.description) delete operation.description
    if (!operation.deprecated) delete operation.deprecated

    // Security (apply globally if configured)
    if (options.security) {
      operation.security = [{ auth: [] }]
    }

    // Input → request body or query params
    if (proc.input) {
      const schema = zodToJsonSchema(proc.input)
      if (method === 'get') {
        operation.parameters = objectSchemaToParams(schema)
      } else {
        operation.requestBody = {
          required: true,
          content: {
            'application/json': { schema },
            'application/x-msgpack': {
              schema: { type: 'string', format: 'binary', description: 'MessagePack encoded' },
            },
          },
        }
      }
    }

    // Output → success response
    const successStatus = route?.successStatus ?? 200
    const successDesc = route?.successDescription ?? 'Successful response'
    if (proc.output) {
      const schema = zodToJsonSchema(proc.output)
      ;(operation.responses as any)[String(successStatus)] = {
        description: successDesc,
        content: {
          'application/json': { schema },
          'application/x-msgpack': { schema: { type: 'string', format: 'binary' } },
          'application/x-devalue+json': {
            schema: { type: 'string', description: 'devalue-encoded (Date, Map, Set, BigInt)' },
          },
        },
      }
    } else {
      ;(operation.responses as any)[String(successStatus)] = { description: successDesc }
    }

    // Errors → error responses
    if (proc.errors) {
      const byStatus = new Map<number, { code: string; schema?: JSONSchema }[]>()
      for (const [code, def] of Object.entries(proc.errors)) {
        const status = typeof def === 'number' ? def : def.status
        if (!byStatus.has(status)) byStatus.set(status, [])
        const entry: { code: string; schema?: JSONSchema } = { code }
        if (typeof def === 'object' && def.data) {
          entry.schema = zodToJsonSchema(def.data)
        }
        byStatus.get(status)!.push(entry)
      }

      for (const [status, errors] of byStatus) {
        const errorSchemas = errors.map((e) => {
          const s: JSONSchema = {
            type: 'object',
            properties: {
              code: { const: e.code, type: 'string' },
              status: { const: status, type: 'integer' },
              message: { type: 'string' },
            },
            required: ['code', 'status', 'message'],
          }
          if (e.schema) {
            s.properties!.data = e.schema
            s.required!.push('data')
          }
          return s
        })

        ;(operation.responses as any)[String(status)] = {
          description: errors.map((e) => e.code).join(' | '),
          content: {
            'application/json': {
              schema: errorSchemas.length === 1 ? errorSchemas[0]! : { oneOf: errorSchemas },
            },
          },
        }
      }
    }

    // Subscription
    if (proc.type === 'subscription') {
      ;(operation.responses as any)[String(successStatus)] = {
        description: 'SSE event stream',
        content: { 'text/event-stream': { schema: { type: 'string' } } },
      }
    }

    paths[httpPath] ??= {}
    paths[httpPath]![method] = operation
  })

  const doc: Record<string, unknown> = {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Katman API',
      version: options.version ?? '1.0.0',
      ...(options.description ? { description: options.description } : {}),
      ...(options.contact ? { contact: options.contact } : {}),
      ...(options.license ? { license: options.license } : {}),
    },
    paths,
  }

  if (options.servers?.length) doc.servers = options.servers
  if (options.externalDocs) doc.externalDocs = options.externalDocs

  // Tags
  if (tags.size > 0) {
    doc.tags = [...tags.entries()].map(([name, meta]) => ({
      name,
      ...(meta.description ? { description: meta.description } : {}),
    }))
  }

  // Security scheme
  if (options.security) {
    const scheme: Record<string, unknown> = { type: options.security.type }
    if (options.security.type === 'http') {
      scheme.scheme = options.security.scheme ?? 'bearer'
      if (options.security.bearerFormat) scheme.bearerFormat = options.security.bearerFormat
    } else if (options.security.type === 'apiKey') {
      scheme.in = options.security.in ?? 'header'
      scheme.name = options.security.name ?? 'x-api-key'
    }
    if (options.security.description) scheme.description = options.security.description
    doc.components = { securitySchemes: { auth: scheme } }
  }

  return doc
}

// ── Scalar HTML ─────────────────────────────────────

const SCALAR_CDN_SOURCES = {
  cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference',
  unpkg: 'https://unpkg.com/@scalar/api-reference',
  local: '/__katman/scalar.js',
} as Record<string, string>

export function scalarHTML(specUrl: string, options: ScalarOptions = {}): string {
  const title = escapeHtml(options.title ?? 'Katman API')
  const safeUrl = escapeHtml(specUrl)
  const cdnOption = options.cdn ?? 'cdn'
  const scriptSrc = escapeHtml(SCALAR_CDN_SOURCES[cdnOption] ?? cdnOption)
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title} — Scalar</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script id="api-reference" data-url="${safeUrl}"></script>
  <script src="${scriptSrc}"></script>
</body>
</html>`
}

/**
 * Resolve @scalar/api-reference JS content from node_modules.
 * Returns the file content as a string, or null if the package is not installed.
 */
export async function resolveScalarLocal(): Promise<string | null> {
  try {
    const { createRequire } = await import('node:module')
    const { readFile } = await import('node:fs/promises')
    const { dirname, join } = await import('node:path')
    const require = createRequire(import.meta.url)
    const entryPath = require.resolve('@scalar/api-reference')
    // The main entry is typically dist/browser/standalone.js or similar
    // Read whatever the package.json "main"/"browser" points to
    const content = await readFile(entryPath, 'utf-8')
    return content
  } catch {
    return null
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Helpers ──────────────────────────────────────────

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'resolve' in value &&
    typeof (value as ProcedureDef).resolve === 'function'
  )
}

function collectProcedures(node: unknown, path: string[], cb: (path: string[], proc: ProcedureDef) => void): void {
  if (isProcedureDef(node)) {
    cb(path, node)
    return
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      collectProcedures(child, [...path, key], cb)
    }
  }
}

/**
 * Convert a Zod / Standard Schema to JSON Schema.
 */
function zodToJsonSchema(schema: AnySchema): JSONSchema {
  const zod = (schema as any)._zod ?? (schema as any)._def
  if (!zod) return {}
  const def = zod.def ?? zod
  return convertZodDef(def)
}

function convertZodDef(def: any): JSONSchema {
  if (!def) return {}
  const type = def.type ?? def.typeName

  switch (type) {
    case 'string':
      return applyStringChecks({ type: 'string' }, def.checks)
    case 'number':
    case 'float':
      return applyNumberChecks({ type: 'number' }, def.checks)
    case 'int':
      return applyNumberChecks({ type: 'integer' }, def.checks)
    case 'boolean':
      return { type: 'boolean' }
    case 'bigint':
      return { type: 'integer', format: 'int64' }
    case 'date':
      return { type: 'string', format: 'date-time' }
    case 'object': {
      const schema: JSONSchema = { type: 'object', properties: {}, required: [] }
      if (def.shape) {
        for (const [key, fieldSchema] of Object.entries(def.shape)) {
          schema.properties![key] = zodToJsonSchema(fieldSchema as AnySchema)
          const fz = (fieldSchema as any)?._zod?.def ?? (fieldSchema as any)?._def
          const isOptional = fz?.type === 'optional' || fz?.typeName === 'ZodOptional' || fz?.optional
          if (!isOptional) schema.required!.push(key)
        }
      }
      if (!schema.required!.length) delete schema.required
      if (def.description) schema.description = def.description
      return schema
    }
    case 'array':
      return {
        type: 'array',
        ...(def.element ? { items: zodToJsonSchema(def.element) } : {}),
      }
    case 'tuple':
      return {
        type: 'array',
        prefixItems: (def.items ?? []).map((item: any) => zodToJsonSchema(item)),
      }
    case 'record':
      return {
        type: 'object',
        additionalProperties: def.valueType ? zodToJsonSchema(def.valueType) : true,
      }
    case 'map':
      return { type: 'object', description: 'Map (serialized as object)' }
    case 'set':
      return {
        type: 'array',
        uniqueItems: true,
        ...(def.valueType ? { items: zodToJsonSchema(def.valueType) } : {}),
      }
    case 'optional':
      return zodToJsonSchema(def.innerType ?? def.inner)
    case 'nullable': {
      const inner = zodToJsonSchema(def.innerType ?? def.inner)
      return { anyOf: [inner, { type: 'null' }] }
    }
    case 'default': {
      const inner = zodToJsonSchema(def.innerType ?? def.inner)
      const defaultVal = typeof def.defaultValue === 'function' ? def.defaultValue() : def.default
      return { ...inner, default: defaultVal }
    }
    case 'enum':
      return { type: 'string', enum: def.values ?? def.entries }
    case 'nativeEnum':
      return { enum: Object.values(def.values ?? {}).filter((v: any) => typeof v !== 'number' || !def.values[v]) }
    case 'literal':
      return { const: def.value }
    case 'union':
      return { anyOf: (def.options ?? def.members ?? []).map((o: any) => zodToJsonSchema(o)) }
    case 'discriminatedUnion':
      return { oneOf: (def.options ?? []).map((o: any) => zodToJsonSchema(o)) }
    case 'intersection': {
      const left = zodToJsonSchema(def.left)
      const right = zodToJsonSchema(def.right)
      return { allOf: [left, right] }
    }
    case 'pipe':
    case 'transform':
      return zodToJsonSchema(def.in ?? def.innerType ?? def.input)
    case 'lazy':
      return def.getter ? zodToJsonSchema(def.getter()) : {}
    case 'any':
    case 'unknown':
      return {}
    case 'void':
    case 'undefined':
      return { type: 'null' }
    case 'never':
      return { not: {} }
    case 'null':
      return { type: 'null' }
    default:
      return {}
  }
}

function applyStringChecks(schema: JSONSchema, checks?: any[]): JSONSchema {
  if (!checks) return schema
  for (const c of checks) {
    const k = c.kind ?? c.type
    if (k === 'min' || k === 'min_length') schema.minLength = c.value ?? c.minimum
    if (k === 'max' || k === 'max_length') schema.maxLength = c.value ?? c.maximum
    if (k === 'length') {
      schema.minLength = c.value
      schema.maxLength = c.value
    }
    if (k === 'email' || c.format === 'email') schema.format = 'email'
    if (k === 'url') schema.format = 'uri'
    if (k === 'uuid') schema.format = 'uuid'
    if (k === 'cuid') schema.format = 'cuid'
    if (k === 'ulid') schema.format = 'ulid'
    if (k === 'datetime' || k === 'iso_datetime') schema.format = 'date-time'
    if (k === 'ip') schema.format = 'ipv4'
    if (k === 'regex') schema.pattern = String(c.value ?? c.regex)
    if (k === 'includes') schema.pattern = c.value
    if (k === 'startsWith') schema.pattern = `^${c.value}`
    if (k === 'endsWith') schema.pattern = `${c.value}$`
  }
  return schema
}

function applyNumberChecks(schema: JSONSchema, checks?: any[]): JSONSchema {
  if (!checks) return schema
  for (const c of checks) {
    const k = c.kind ?? c.type
    if (k === 'min' || k === 'minimum' || k === 'gte') schema.minimum = c.value ?? c.minimum
    if (k === 'max' || k === 'maximum' || k === 'lte') schema.maximum = c.value ?? c.maximum
    if (k === 'int') schema.type = 'integer'
    if (k === 'positive') schema.minimum = 0
    if (k === 'negative') schema.maximum = 0
    if (k === 'multipleOf') schema.multipleOf = c.value
  }
  return schema
}

function objectSchemaToParams(schema: JSONSchema): Record<string, unknown>[] {
  if (schema.type !== 'object' || !schema.properties) return []
  const required = new Set(schema.required ?? [])
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    in: 'query',
    required: required.has(name),
    schema: propSchema,
    ...(propSchema.description ? { description: propSchema.description } : {}),
  }))
}
