/**
 * OpenAPI 3.x spec parser.
 *
 * Walks an OpenAPI document and extracts operations with their
 * parameters, request body, responses, and error definitions.
 */

// ── Types ──────────────────────────────────────────────

export interface OpenAPISpec {
  openapi: string
  info: { title: string; version: string; description?: string }
  paths?: Record<string, PathItem>
  components?: {
    schemas?: Record<string, JsonSchema>
    securitySchemes?: Record<string, unknown>
  }
  tags?: { name: string; description?: string }[]
  servers?: { url: string; description?: string }[]
}

export interface PathItem {
  get?: OperationObject
  post?: OperationObject
  put?: OperationObject
  patch?: OperationObject
  delete?: OperationObject
  head?: OperationObject
  options?: OperationObject
  trace?: OperationObject
  parameters?: ParameterObject[]
}

export interface OperationObject {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  parameters?: ParameterObject[]
  requestBody?: RequestBodyObject
  responses?: Record<string, ResponseObject>
  security?: Record<string, string[]>[]
}

export interface ParameterObject {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  schema?: JsonSchema
  description?: string
  deprecated?: boolean
  $ref?: string
}

export interface RequestBodyObject {
  required?: boolean
  content?: Record<string, { schema?: JsonSchema }>
  description?: string
  $ref?: string
}

export interface ResponseObject {
  description?: string
  content?: Record<string, { schema?: JsonSchema }>
  $ref?: string
}

export interface JsonSchema {
  [key: string]: unknown
}

// ── Parsed Output ──────────────────────────────────────

export interface ParsedOperation {
  /** e.g. "getUser" */
  operationId: string
  /** HTTP method uppercase */
  method: string
  /** OpenAPI path, e.g. "/users/{id}" */
  path: string
  /** Silgi path, e.g. "/users/:id" */
  silgiPath: string
  summary?: string
  description?: string
  tags: string[]
  deprecated: boolean
  /** Path parameters */
  pathParams: ParsedParam[]
  /** Query parameters */
  queryParams: ParsedParam[]
  /** Request body JSON Schema (if any) */
  body: JsonSchema | null
  bodyRequired: boolean
  /** Success response schema */
  successSchema: JsonSchema | null
  successStatus: number
  /** Error responses: status code → schema */
  errors: Map<number, { description: string; schema: JsonSchema | null }>
  /** Security requirement (false = public) */
  security: string[] | false | null
}

export interface ParsedParam {
  name: string
  required: boolean
  schema: JsonSchema
  description?: string
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const

// ── Parser ─────────────────────────────────────────────

export function parseOpenAPI(spec: OpenAPISpec): {
  operations: ParsedOperation[]
  components: Record<string, JsonSchema>
  tags: { name: string; description?: string }[]
} {
  const operations: ParsedOperation[] = []
  const components = spec.components?.schemas ?? {}
  const tags = spec.tags ?? []

  if (!spec.paths) return { operations, components, tags }

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    // Path-level parameters (shared across methods)
    const sharedParams = resolveParams(pathItem.parameters ?? [], spec)

    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!op) continue

      // Merge path-level + operation-level params
      const opParams = resolveParams(op.parameters ?? [], spec)
      const allParams = mergeParams(sharedParams, opParams)

      const pathParams = allParams.filter((p) => p.in === 'path')
      const queryParams = allParams.filter((p) => p.in === 'query')

      // Request body
      const bodyObj = op.requestBody ? resolveRef<RequestBodyObject>(op.requestBody, spec) : null
      const bodySchema = bodyObj ? extractBodySchema(bodyObj) : null

      // Responses
      const { successSchema, successStatus, errors } = parseResponses(op.responses ?? {}, spec)

      // Security
      let security: string[] | false | null = null
      if (op.security) {
        if (op.security.length === 0) {
          security = false // explicitly public
        } else {
          security = op.security.flatMap((s) => Object.keys(s))
        }
      }

      operations.push({
        operationId: op.operationId ?? generateOperationId(method, path),
        method: method.toUpperCase(),
        path,
        silgiPath: toSilgiPath(path),
        summary: op.summary,
        description: op.description,
        tags: op.tags ?? [],
        deprecated: op.deprecated ?? false,
        pathParams: pathParams.map((p) => ({
          name: p.name,
          required: p.required ?? true,
          schema: p.schema ?? { type: 'string' },
          description: p.description,
        })),
        queryParams: queryParams.map((p) => ({
          name: p.name,
          required: p.required ?? false,
          schema: p.schema ?? { type: 'string' },
          description: p.description,
        })),
        body: bodySchema,
        bodyRequired: bodyObj?.required ?? false,
        successSchema,
        successStatus,
        errors,
        security,
      })
    }
  }

  return { operations, components, tags }
}

// ── Helpers ────────────────────────────────────────────

/**
 * Convert OpenAPI path to Silgi path.
 * `/users/{id}/posts/{postId}` → `/users/:id/posts/:postId`
 */
function toSilgiPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1')
}

/**
 * Generate a fallback operationId from method + path.
 * `GET /users/{id}` → `getUsers_id`
 */
function generateOperationId(method: string, path: string): string {
  const segments = path
    .replace(/\{([^}]+)\}/g, '$1')
    .split('/')
    .filter(Boolean)
  const camel = segments
    .map((s, i) => (i === 0 ? s : s[0]!.toUpperCase() + s.slice(1)))
    .join('')
  return method + camel[0]!.toUpperCase() + camel.slice(1)
}

function resolveRef<T>(obj: T & { $ref?: string }, spec: OpenAPISpec): T {
  if (!obj || typeof obj !== 'object' || !('$ref' in obj) || !obj.$ref) return obj
  const ref = obj.$ref as string
  const parts = ref.replace('#/', '').split('/')
  let current: unknown = spec
  for (const part of parts) {
    current = (current as Record<string, unknown>)?.[part]
  }
  return (current ?? obj) as T
}

function resolveParams(params: ParameterObject[], spec: OpenAPISpec): ParameterObject[] {
  return params.map((p) => resolveRef(p, spec))
}

function mergeParams(shared: ParameterObject[], op: ParameterObject[]): ParameterObject[] {
  const map = new Map<string, ParameterObject>()
  for (const p of shared) map.set(`${p.in}:${p.name}`, p)
  for (const p of op) map.set(`${p.in}:${p.name}`, p) // op overrides shared
  return [...map.values()]
}

function extractBodySchema(body: RequestBodyObject): JsonSchema | null {
  if (!body.content) return null
  const json = body.content['application/json'] ?? body.content['*/*']
  return json?.schema ?? null
}

function parseResponses(
  responses: Record<string, ResponseObject>,
  spec: OpenAPISpec,
): {
  successSchema: JsonSchema | null
  successStatus: number
  errors: Map<number, { description: string; schema: JsonSchema | null }>
} {
  let successSchema: JsonSchema | null = null
  let successStatus = 200
  const errors = new Map<number, { description: string; schema: JsonSchema | null }>()

  for (const [statusCode, rawResp] of Object.entries(responses)) {
    const resp = resolveRef(rawResp, spec)
    const status = statusCode === 'default' ? 500 : Number.parseInt(statusCode, 10)
    const schema = extractResponseSchema(resp)

    if (status >= 200 && status < 300) {
      if (!successSchema) {
        successSchema = schema
        successStatus = status
      }
    } else if (status >= 400) {
      errors.set(status, { description: resp.description ?? '', schema })
    }
  }

  return { successSchema, successStatus, errors }
}

function extractResponseSchema(resp: ResponseObject): JsonSchema | null {
  if (!resp.content) return null
  const json = resp.content['application/json'] ?? resp.content['*/*']
  return json?.schema ?? null
}
