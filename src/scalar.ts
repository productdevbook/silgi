/**
 * Scalar API Reference — v2 OpenAPI integration.
 *
 * Generates OpenAPI 3.1.0 spec from v2 RouterDef and serves
 * Scalar UI at /reference + spec at /openapi.json.
 */

import type { AnySchema } from './core/schema.ts'
import type { ProcedureDef, RouterDef, Route } from './types.ts'

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
/**
 * Convert `:param` and `:param(regex)` to OpenAPI `{param}` syntax.
 * Returns the converted path and an array of extracted param names.
 */
function toOpenAPIPath(raw: string): { httpPath: string; pathParams: string[] } {
  const pathParams: string[] = []
  const httpPath = raw
    // Convert :param(regex) → {param}
    .replace(/:(\w+)\([^)]*\)/g, (_m, name) => {
      pathParams.push(name)
      return `{${name}}`
    })
    // Convert :param? → {param}
    .replace(/:(\w+)\?/g, (_m, name) => {
      pathParams.push(name)
      return `{${name}}`
    })
    // Convert :param → {param}
    .replace(/:(\w+)/g, (_m, name) => {
      pathParams.push(name)
      return `{${name}}`
    })
    // Convert ** wildcard → {path}
    .replace(/\/\*\*$/g, '/{path}')
    .replace(/\/\*\*/g, '/{path}')
  if (httpPath.includes('{path}') && !pathParams.includes('path')) pathParams.push('path')
  return { httpPath, pathParams }
}

export function generateOpenAPI(router: RouterDef, options: ScalarOptions = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Map<string, { description?: string }>()

  collectProcedures(router, [], (path, proc) => {
    const route = proc.route as Route | null
    const rawPath = route?.path ?? '/' + path.join('/')
    const { httpPath, pathParams } = toOpenAPIPath(rawPath)
    const rawMethod = route?.method?.toLowerCase() ?? 'post'
    const validMethods = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']
    const methods = rawMethod === '*' ? validMethods : [rawMethod]

    // operationId: user override > auto-generated from path
    const baseOperationId = route?.operationId ?? path.join('_')

    // Tags: user override > auto-generated from first path segment
    const opTags = route?.tags ?? (path.length > 1 ? [path[0]!] : undefined)
    if (opTags) {
      for (const t of opTags) {
        if (!tags.has(t)) tags.set(t, {})
      }
    }

    // Description (append WebSocket note if applicable)
    let description = route?.description
    if (route?.ws) {
      const wsNote =
        'Also available over WebSocket (`ws://`). Send `{ id, path: "' + path.join('/') + '", input }` as JSON.'
      description = description ? `${description}\n\n${wsNote}` : wsNote
    }

    const operation: Record<string, unknown> = {
      operationId: baseOperationId,
      tags: opTags,
      summary: route?.summary,
      description,
      deprecated: route?.deprecated || undefined,
      responses: {},
    }

    // Remove undefined fields
    if (!operation.summary) delete operation.summary
    if (!operation.description) delete operation.description
    if (!operation.deprecated) delete operation.deprecated
    if (!operation.tags) delete operation.tags

    // Security: per-procedure override > global
    if (route?.security === false) {
      operation.security = [] // public — no auth
    } else if (route?.security) {
      operation.security = route.security.map((s) => ({ [s]: [] }))
    } else if (options.security) {
      operation.security = [{ auth: [] }]
    }

    // Input schema
    const inputSchema = proc.input ? schemaToJsonSchema(proc.input) : null

    // Output
    const successStatus = route?.successStatus ?? 200
    const successDesc = route?.successDescription ?? 'Successful response'

    // Errors (merge guard errors + procedure errors)
    const guards = (proc.use ?? []).filter((m: any) => m.kind === 'guard' && m.errors)
    let allErrors = proc.errors ? { ...proc.errors } : null
    for (const guard of guards) {
      const ge = (guard as any).errors
      if (ge) allErrors = allErrors ? { ...allErrors, ...ge } : { ...ge }
    }

    paths[httpPath] ??= {}

    for (const method of methods) {
      const op = { ...operation, responses: {} as Record<string, unknown> } as typeof operation & {
        operationId?: string
        requestBody?: unknown
        parameters?: unknown[]
        responses: Record<string, unknown>
      }
      if (methods.length > 1) op.operationId = `${baseOperationId}_${method}`

      // Path parameters
      const params: Record<string, unknown>[] = []
      for (const p of pathParams) {
        params.push({ name: p, in: 'path', required: true, schema: { type: 'string' } })
      }

      // Input → query params (GET) or request body (POST/PUT/etc.)
      if (inputSchema) {
        if (method === 'get') {
          params.push(...objectSchemaToParams(inputSchema))
        } else {
          op.requestBody = {
            required: true,
            content: { 'application/json': { schema: inputSchema } },
          }
        }
      }

      if (params.length > 0) op.parameters = params

      // Success response
      if (proc.type === 'subscription') {
        const outputSchema = proc.output ? schemaToJsonSchema(proc.output) : { type: 'string' }
        op.responses[String(successStatus)] = {
          description: 'SSE event stream',
          content: {
            'text/event-stream': {
              schema: { type: 'string', description: `Each line: data: ${JSON.stringify(outputSchema)}` },
            },
          },
        }
      } else if (proc.output) {
        op.responses[String(successStatus)] = {
          description: successDesc,
          content: { 'application/json': { schema: schemaToJsonSchema(proc.output) } },
        }
      } else {
        op.responses[String(successStatus)] = { description: successDesc }
      }

      // Auto-document 400 BAD_REQUEST for procedures with input validation
      if (proc.input) {
        op.responses['400'] = {
          description: 'BAD_REQUEST — input validation failed',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  code: { const: 'BAD_REQUEST', type: 'string' },
                  status: { const: 400, type: 'integer' },
                  message: { type: 'string' },
                  data: { type: 'object', properties: { issues: { type: 'array' } } },
                },
                required: ['code', 'status', 'message'],
              },
            },
          },
        }
      }

      // Typed error responses
      if (allErrors) {
        const byStatus = new Map<number, { code: string; message?: string; schema?: JSONSchema }[]>()
        for (const [code, def] of Object.entries(allErrors)) {
          const status = typeof def === 'number' ? def : def.status
          if (!byStatus.has(status)) byStatus.set(status, [])
          const entry: { code: string; message?: string; schema?: JSONSchema } = { code }
          if (typeof def === 'object') {
            if (def.message) entry.message = def.message
            if (def.data) entry.schema = schemaToJsonSchema(def.data)
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
                message: { type: 'string', ...(e.message ? { default: e.message } : {}) },
              },
              required: ['code', 'status', 'message'],
            }
            if (e.schema) {
              s.properties!.data = e.schema
              s.required!.push('data')
            }
            return s
          })

          op.responses[String(status)] = {
            description: errors.map((e) => e.code).join(' | '),
            content: {
              'application/json': {
                schema: errorSchemas.length === 1 ? errorSchemas[0]! : { oneOf: errorSchemas },
              },
            },
          }
        }
      }

      // Apply user-defined spec override
      let finalOp = op as Record<string, unknown>
      if (route?.spec) {
        if (typeof route.spec === 'function') {
          finalOp = route.spec(finalOp)
        } else {
          finalOp = { ...finalOp, ...route.spec }
        }
      }

      paths[httpPath]![method] = finalOp
    }
  })

  const doc: Record<string, unknown> = {
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'Silgi API',
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
  local: '/__silgi/scalar.js',
} as Record<string, string>

export function scalarHTML(specUrl: string, options: ScalarOptions = {}): string {
  const title = escapeHtml(options.title ?? 'Silgi API')
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
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const resolved = import.meta.resolve('@scalar/api-reference')
    const filePath = fileURLToPath(resolved)
    const content = await readFile(filePath, 'utf-8')
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
 * Convert a Standard Schema to JSON Schema via `~standard.jsonSchema.input()`.
 *
 * Works with Zod v4, Valibot, ArkType — any validator implementing Standard Schema v1.
 */
function schemaToJsonSchema(schema: AnySchema): JSONSchema {
  const std = (schema as any)['~standard']
  if (!std?.jsonSchema?.input) return {}
  try {
    const result = std.jsonSchema.input({ target: 'draft-2020-12' })
    if (result && typeof result === 'object') {
      const { $schema: _, ...rest } = result as Record<string, unknown>
      return rest as JSONSchema
    }
  } catch {}
  return {}
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

// ── Handler Wrapper ─────────────────────────────────

import type { FetchHandler } from './core/handler.ts'

/**
 * Wrap a fetch handler to serve Scalar API Reference at /reference and /openapi.json.
 * Scalar routes are intercepted before the handler — zero overhead for normal requests.
 */
export function wrapWithScalar(handler: FetchHandler, routerDef: RouterDef, options: ScalarOptions = {}): FetchHandler {
  const specJson = JSON.stringify(generateOpenAPI(routerDef, options))
  const specHtml = scalarHTML('/openapi.json', options)

  return (request: Request): Response | Promise<Response> => {
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    if (pathname === 'openapi.json') {
      return new Response(specJson, { headers: { 'content-type': 'application/json' } })
    }
    if (pathname === 'reference') {
      return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
    }

    return handler(request)
  }
}
