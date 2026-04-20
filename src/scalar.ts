/**
 * Scalar API Reference + OpenAPI 3.1.0 generation
 * --------------------------------------------------
 *
 * Walks a silgi `RouterDef` and emits an OpenAPI 3.1.0 document, then
 * wraps a Fetch handler so that two additional routes are served:
 *
 *   `{basePath}/openapi.json`  — the raw spec.
 *   `{basePath}/reference`     — the Scalar API Reference UI (HTML).
 *
 * Every procedure becomes one OpenAPI operation per HTTP method. Input
 * schemas become `parameters[in:query]` for GET and `requestBody` for
 * the rest. Typed errors declared via `.$errors()` become typed response
 * shapes grouped by status code. Subscriptions are documented as SSE
 * endpoints (clients are still expected to use the native WebSocket
 * channel; the REST representation is for discoverability).
 *
 * The document respects per-procedure escape hatches in that order:
 *
 *   `route.spec` — either a function `(op) => op` or an object merge.
 *   `route.security` — per-op security override (or `false` for public).
 *   `route.successStatus` / `route.successDescription` — success shape.
 */

import { collectProcedures } from './core/router-utils.ts'
import { schemaToJsonSchema as convertSchemaToJsonSchema } from './core/schema-converter.ts'

import type { FetchHandler } from './core/handler.ts'
import type { ConvertOptions, JSONSchema, SchemaRegistry } from './core/schema-converter.ts'
import type { AnySchema } from './core/schema.ts'
import type { RouterDef, Route } from './types.ts'

// ─── Public options ───────────────────────────────────────────────────

export interface ScalarOptions {
  title?: string
  version?: string
  description?: string
  servers?: { url: string; description?: string }[]
  /** Security scheme (e.g. Bearer token, API key header). */
  security?: {
    type: 'http' | 'apiKey'
    /** For `type: 'http'`, e.g. `'bearer'`. */
    scheme?: string
    /** For `type: 'http'` + bearer, e.g. `'JWT'`. */
    bearerFormat?: string
    /** For `type: 'apiKey'`, which side of the request carries the key. */
    in?: 'header' | 'query'
    /** For `type: 'apiKey'`, the header / query-param name. */
    name?: string
    description?: string
  }
  contact?: { name?: string; url?: string; email?: string }
  license?: { name: string; url?: string }
  externalDocs?: { url: string; description?: string }
  /**
   * Where to load the Scalar UI script from.
   *
   *   `'cdn'`   — `cdn.jsdelivr.net` (default).
   *   `'unpkg'` — `unpkg.com`.
   *   `'local'` — serve from `node_modules` (offline; requires the
   *               `@scalar/api-reference` package installed).
   *   string    — any custom URL, e.g. a self-hosted asset path.
   */
  cdn?: 'cdn' | 'unpkg' | 'local' | (string & {})
}

// ─── Path helpers ─────────────────────────────────────────────────────

/**
 * Convert silgi's `:param`, `:param?`, `:param(regex)`, and `**`
 * route syntax to OpenAPI's `{param}` form, and collect the extracted
 * parameter names so callers can list them in the operation's
 * `parameters`.
 */
function toOpenAPIPath(raw: string): { httpPath: string; pathParams: string[] } {
  const pathParams: string[] = []

  const httpPath = raw
    .replace(/:(\w+)\([^)]*\)/g, (_match, name) => {
      pathParams.push(name)
      return `{${name}}`
    })
    .replace(/:(\w+)\?/g, (_match, name) => {
      pathParams.push(name)
      return `{${name}}`
    })
    .replace(/:(\w+)/g, (_match, name) => {
      pathParams.push(name)
      return `{${name}}`
    })
    .replace(/\/\*\*$/g, '/{path}')
    .replace(/\/\*\*/g, '/{path}')

  if (httpPath.includes('{path}') && !pathParams.includes('path')) pathParams.push('path')
  return { httpPath, pathParams }
}

// ─── Small helpers ────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const

/** Escape a string for inclusion in HTML attribute or text content. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Turn a flat object schema into OpenAPI query-parameter entries. Used
 * for `GET` routes: the body is moved to the URL.
 */
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

// ─── Error grouping ───────────────────────────────────────────────────

/**
 * Collect every typed error declared by a procedure *and* by any guard
 * it uses, keyed by HTTP status. Guard errors merge into the procedure
 * errors on a collision (procedure wins).
 */
function collectTypedErrors(proc: {
  errors?: Record<string, unknown> | null
  use?: readonly unknown[] | null
}): Record<string, unknown> | null {
  const guards = (proc.use ?? []).filter(
    (m): m is { kind: 'guard'; errors: Record<string, unknown> } =>
      typeof m === 'object' && m !== null && (m as any).kind === 'guard' && !!(m as any).errors,
  )

  let merged = proc.errors ? { ...proc.errors } : null
  for (const guard of guards) {
    merged = merged ? { ...merged, ...guard.errors } : { ...guard.errors }
  }
  return merged
}

/** One rendered error entry for a given status code. */
interface ErrorEntry {
  code: string
  message?: string
  schema?: JSONSchema
}

/** Group typed errors by status code; each status may carry N codes. */
function groupErrorsByStatus(
  errors: Record<string, unknown>,
  schemaToJson: (s: AnySchema) => JSONSchema,
): Map<number, ErrorEntry[]> {
  const byStatus = new Map<number, ErrorEntry[]>()

  for (const [code, rawDef] of Object.entries(errors)) {
    const status = typeof rawDef === 'number' ? rawDef : (rawDef as { status: number }).status
    if (!byStatus.has(status)) byStatus.set(status, [])

    const entry: ErrorEntry = { code }
    if (typeof rawDef === 'object' && rawDef !== null) {
      const def = rawDef as { message?: string; data?: AnySchema }
      if (def.message) entry.message = def.message
      if (def.data) entry.schema = schemaToJson(def.data)
    }
    byStatus.get(status)!.push(entry)
  }

  return byStatus
}

/** Build one response-object schema for a typed error. */
function errorEntryToJsonSchema(entry: ErrorEntry, status: number): JSONSchema {
  const schema: JSONSchema = {
    type: 'object',
    properties: {
      code: { const: entry.code, type: 'string' },
      status: { const: status, type: 'integer' },
      message: { type: 'string', ...(entry.message ? { default: entry.message } : {}) },
    },
    required: ['code', 'status', 'message'],
  }
  if (entry.schema) {
    schema.properties!.data = entry.schema
    schema.required!.push('data')
  }
  return schema
}

// ─── Operation builder ────────────────────────────────────────────────

interface BuildOpArgs {
  proc: {
    type: string
    input: AnySchema | null
    output: AnySchema | null
    errors?: Record<string, unknown> | null
    use?: readonly unknown[] | null
    route: Route | null
  }
  path: string[]
  method: (typeof HTTP_METHODS)[number]
  operationId: string
  tags: string[] | undefined
  summary: string | undefined
  description: string | undefined
  deprecated: boolean | undefined
  pathParams: string[]
  inputSchema: JSONSchema | null
  schemaToJson: (schema: AnySchema, strategy?: ConvertOptions['strategy']) => JSONSchema
  globalSecurity: ScalarOptions['security']
}

/**
 * Build one OpenAPI operation object (the value for `paths[p][method]`).
 *
 * Parameters are path-params first, then query-params for GETs. Body
 * goes on the request side for non-GETs. Responses are the declared
 * success status plus an auto-documented 400 (when input validation
 * exists) plus one slot per typed-error status.
 */
function buildOperation(args: BuildOpArgs): Record<string, unknown> {
  const { proc, path, method, inputSchema, schemaToJson } = args

  const op: Record<string, unknown> = { operationId: args.operationId, responses: {} }
  if (args.tags?.length) op.tags = args.tags
  if (args.summary) op.summary = args.summary
  if (args.description) op.description = args.description
  if (args.deprecated) op.deprecated = true

  // Security: per-operation override wins; `false` forces public.
  const route = proc.route
  if (route?.security === false) {
    op.security = []
  } else if (route?.security) {
    op.security = route.security.map((s) => ({ [s]: [] }))
  } else if (args.globalSecurity) {
    op.security = [{ auth: [] }]
  }

  // Parameters — path params always, plus query params when the input
  // is carried in the URL.
  const parameters: Record<string, unknown>[] = args.pathParams.map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }))

  if (inputSchema) {
    if (method === 'get') {
      parameters.push(...objectSchemaToParams(inputSchema))
    } else {
      op.requestBody = {
        required: true,
        content: { 'application/json': { schema: inputSchema } },
      }
    }
  }
  if (parameters.length > 0) op.parameters = parameters

  // Responses
  const responses = op.responses as Record<string, unknown>
  const successStatus = route?.successStatus ?? 200
  const successDesc = route?.successDescription ?? 'Successful response'

  if (proc.type === 'subscription') {
    const outputSchema = proc.output ? schemaToJson(proc.output, 'output') : { type: 'string' }
    responses[String(successStatus)] = {
      description: 'SSE event stream',
      content: {
        'text/event-stream': {
          schema: { type: 'string', description: `Each line: data: ${JSON.stringify(outputSchema)}` },
        },
      },
    }
  } else if (proc.output) {
    responses[String(successStatus)] = {
      description: successDesc,
      content: { 'application/json': { schema: schemaToJson(proc.output, 'output') } },
    }
  } else {
    responses[String(successStatus)] = { description: successDesc }
  }

  // Auto-documented 400 for procedures that validate input.
  if (proc.input) {
    responses['400'] = {
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

  // Typed error responses declared via `.$errors()` on the procedure or its guards.
  const typedErrors = collectTypedErrors(proc)
  if (typedErrors) {
    const byStatus = groupErrorsByStatus(typedErrors, schemaToJson)
    for (const [status, entries] of byStatus) {
      const schemas = entries.map((entry) => errorEntryToJsonSchema(entry, status))
      responses[String(status)] = {
        description: entries.map((e) => e.code).join(' | '),
        content: {
          'application/json': {
            schema: schemas.length === 1 ? schemas[0]! : { oneOf: schemas },
          },
        },
      }
    }
  }

  // `route.spec` escape hatch — either a function transform or a
  // plain-object merge. Runs last so user overrides win over our
  // defaults.
  let finalOp = op
  if (route?.spec) {
    finalOp = typeof route.spec === 'function' ? route.spec(op) : { ...op, ...route.spec }
  }

  // Add the `_method` suffix to operationId when a wildcard route emits
  // multiple HTTP methods — otherwise every method would share the same
  // ID, which is illegal per OpenAPI.
  void path
  return finalOp
}

// ─── Doc-level sections ───────────────────────────────────────────────

/** Build the `info` field of the doc, plus optional `servers` / `externalDocs`. */
function buildDocHeader(options: ScalarOptions): {
  info: Record<string, unknown>
  extras: Record<string, unknown>
} {
  const info: Record<string, unknown> = {
    title: options.title ?? 'Silgi API',
    version: options.version ?? '1.0.0',
  }
  if (options.description) info.description = options.description
  if (options.contact) info.contact = options.contact
  if (options.license) info.license = options.license

  const extras: Record<string, unknown> = {}
  if (options.servers?.length) extras.servers = options.servers
  if (options.externalDocs) extras.externalDocs = options.externalDocs

  return { info, extras }
}

/**
 * Translate our compact `security` option into the OpenAPI
 * `components.securitySchemes` shape. The key under which the scheme
 * lives is hard-coded as `auth` — per-operation `security` values
 * reference it by that name.
 */
function buildSecurityScheme(security: NonNullable<ScalarOptions['security']>): Record<string, unknown> {
  const scheme: Record<string, unknown> = { type: security.type }

  if (security.type === 'http') {
    scheme.scheme = security.scheme ?? 'bearer'
    if (security.bearerFormat) scheme.bearerFormat = security.bearerFormat
  } else if (security.type === 'apiKey') {
    scheme.in = security.in ?? 'header'
    scheme.name = security.name ?? 'x-api-key'
  }
  if (security.description) scheme.description = security.description

  return { securitySchemes: { auth: scheme } }
}

// ─── Top-level generator ──────────────────────────────────────────────

/**
 * Generate an OpenAPI 3.1.0 document for a `RouterDef`.
 *
 * The document is a plain object and can be re-serialized, cached,
 * piped into any OpenAPI consumer (codegen, docs site, validators). We
 * do not return a typed `OpenAPIV3_1.Document` because the typings in
 * the ecosystem are noisy; downstream consumers usually only care
 * about a handful of keys anyway.
 */
export function generateOpenAPI(
  router: RouterDef,
  options: ScalarOptions = {},
  basePath: string = '',
  registry?: SchemaRegistry,
): Record<string, unknown> {
  // Local adapter around the core converter so we do not have to keep
  // passing `registry` + cast to the scalar-local `JSONSchema` shape.
  const schemaToJson = (schema: AnySchema, strategy: ConvertOptions['strategy'] = 'input'): JSONSchema =>
    convertSchemaToJsonSchema(schema, strategy, registry) as JSONSchema

  const paths: Record<string, Record<string, unknown>> = {}
  const tags = new Map<string, { description?: string }>()

  collectProcedures(router, (path, proc) => {
    const route = proc.route as Route | null
    const rawPath = route?.path ?? '/' + path.join('/')
    const { httpPath: routePath, pathParams } = toOpenAPIPath(rawPath)
    const httpPath = basePath ? basePath.replace(/\/$/, '') + routePath : routePath

    // Methods: `*` expands to every HTTP verb; otherwise the declared
    // method (defaulting to `post`).
    const declaredMethod = route?.method?.toLowerCase() ?? 'post'
    const methods: (typeof HTTP_METHODS)[number][] =
      declaredMethod === '*' ? [...HTTP_METHODS] : [declaredMethod as (typeof HTTP_METHODS)[number]]

    // operationId + tags default to the tree position; users may
    // override either on the route metadata.
    const baseOperationId = route?.operationId ?? path.join('_')
    const opTags = route?.tags ?? (path.length > 1 ? [path[0]!] : undefined)
    if (opTags) {
      for (const tag of opTags) {
        if (!tags.has(tag)) tags.set(tag, {})
      }
    }

    // Subscriptions document an SSE representation here for
    // discoverability, but the live protocol is WebSocket. We prepend
    // a short note to the description so readers of the spec do not
    // misuse the SSE mount as a subscription entry point.
    let description = route?.description
    if (proc.type === 'subscription') {
      const wsNote =
        'Streams over WebSocket (`ws://…/_ws`). Send `{ id, path: "' + path.join('/') + '", input }` as JSON.'
      description = description ? `${description}\n\n${wsNote}` : wsNote
    }

    const inputSchema = proc.input ? schemaToJson(proc.input, 'input') : null

    paths[httpPath] ??= {}

    for (const method of methods) {
      const operationId = methods.length > 1 ? `${baseOperationId}_${method}` : baseOperationId
      const op = buildOperation({
        proc: proc as BuildOpArgs['proc'],
        path,
        method,
        operationId,
        tags: opTags,
        summary: route?.summary,
        description,
        deprecated: route?.deprecated || undefined,
        pathParams,
        inputSchema,
        schemaToJson,
        globalSecurity: options.security,
      })
      paths[httpPath]![method] = op
    }
  })

  const { info, extras } = buildDocHeader(options)

  const doc: Record<string, unknown> = {
    openapi: '3.1.0',
    info,
    paths,
    ...extras,
  }

  if (tags.size > 0) {
    doc.tags = [...tags.entries()].map(([name, meta]) => ({
      name,
      ...(meta.description ? { description: meta.description } : {}),
    }))
  }

  if (options.security) {
    doc.components = buildSecurityScheme(options.security)
  }

  return doc
}

// ─── Scalar UI HTML + asset resolution ────────────────────────────────

const SCALAR_CDN_SOURCES: Record<string, string> = {
  cdn: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference',
  unpkg: 'https://unpkg.com/@scalar/api-reference',
  local: '/__silgi/scalar.js',
}

/**
 * Render the minimal HTML shell the Scalar UI needs. The UI itself is
 * a single script that reads the `data-url` attribute to pull the spec.
 */
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
 * Resolve `@scalar/api-reference` off the local `node_modules` tree.
 * Returns the JS content, or `null` when the package is not installed
 * — callers fall back to a CDN URL in that case.
 */
export async function resolveScalarLocal(): Promise<string | null> {
  try {
    const { readFile } = await import('node:fs/promises')
    const { fileURLToPath } = await import('node:url')
    const resolved = import.meta.resolve('@scalar/api-reference')
    const filePath = fileURLToPath(resolved)
    return await readFile(filePath, 'utf-8')
  } catch {
    // `import.meta.resolve` throws when the package is absent, and
    // `readFile` throws when the resolved path does not exist. Either
    // way the caller is happy to fall back to the CDN.
    return null
  }
}

// ─── Handler wrapper ──────────────────────────────────────────────────

/**
 * Wrap a Fetch handler so that two extra paths are served:
 *
 *   `{basePath}/reference`    — the Scalar UI.
 *   `{basePath}/openapi.json` — the spec.
 *
 * The generated spec is JSON-stringified once at wrap time so every
 * hit to `/openapi.json` is a constant-cost `new Response(cachedJson)`.
 * Requests that do not match either path fall through to the inner
 * handler with zero overhead.
 */
export function wrapWithScalar(
  handler: FetchHandler,
  routerDef: RouterDef,
  options: ScalarOptions = {},
  prefix: string = '/api',
  registry?: SchemaRegistry,
): FetchHandler {
  // Normalise prefix: leading slash, no trailing slash.
  const normPrefix = (prefix.startsWith('/') ? prefix : '/' + prefix).replace(/\/+$/, '')

  const specJson = JSON.stringify(generateOpenAPI(routerDef, options, normPrefix, registry))
  const specUrl = `${normPrefix}/openapi.json`
  const specHtml = scalarHTML(specUrl, options)

  // The URL parser we use below returns pathnames without a leading
  // slash; match targets follow the same convention.
  const openapiMatch = `${normPrefix.slice(1)}/openapi.json`
  const referenceMatch = `${normPrefix.slice(1)}/reference`

  return (request: Request): Response | Promise<Response> => {
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    if (pathname === openapiMatch) {
      return new Response(specJson, { headers: { 'content-type': 'application/json' } })
    }
    if (pathname === referenceMatch) {
      return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
    }

    return handler(request)
  }
}
