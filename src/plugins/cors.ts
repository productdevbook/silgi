/**
 * CORS plugin — response header helper.
 *
 * Returns CORS headers to merge into responses.
 * Handles preflight OPTIONS requests automatically via the handler.
 */

export interface CORSOptions {
  origin?: string | string[] | ((origin: string) => boolean)
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

/**
 * Create CORS headers config for silgi().
 *
 * @example
 * ```ts
 * import { cors } from "silgi/cors"
 *
 * const k = silgi({
 *   context: (req) => ({}),
 *   hooks: cors({ origin: "https://app.example.com", credentials: true }),
 * })
 * ```
 */
export function cors(options: CORSOptions = {}): { headers: Record<string, string>; options: CORSOptions } {
  const origin = options.origin ?? '*'
  if (options.credentials && typeof origin === 'string' && origin === '*') {
    throw new Error('[silgi/cors] Cannot use credentials: true with origin: "*". Set an explicit origin.')
  }
  return {
    headers: corsHeaders(options),
    options,
  }
}

/**
 * CORS header map — use in custom serve() or middleware.
 * Returns headers object to merge into responses.
 *
 * For dynamic origins (array/function), omits Access-Control-Allow-Origin
 * entirely when the request origin is not allowed — this is the correct
 * behavior per the CORS spec (browsers reject missing header).
 */
export function corsHeaders(options: CORSOptions = {}, requestOrigin?: string): Record<string, string> {
  const origin = options.origin ?? '*'
  const methods = options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  const allowedHeaders = options.allowedHeaders ?? ['Content-Type', 'Authorization']

  const headers: Record<string, string> = {
    'access-control-allow-methods': methods.join(', '),
    'access-control-allow-headers': allowedHeaders.join(', '),
  }

  // Origin — omit header entirely for disallowed origins (correct CORS behavior)
  if (typeof origin === 'string') {
    headers['access-control-allow-origin'] = origin
  } else if (Array.isArray(origin)) {
    if (requestOrigin && origin.includes(requestOrigin)) {
      headers['access-control-allow-origin'] = requestOrigin
    }
    headers['vary'] = 'Origin'
  } else if (typeof origin === 'function' && requestOrigin) {
    if (origin(requestOrigin)) {
      headers['access-control-allow-origin'] = requestOrigin
    }
    headers['vary'] = 'Origin'
  }

  if (options.credentials) headers['access-control-allow-credentials'] = 'true'
  if (options.maxAge !== undefined) headers['access-control-max-age'] = String(options.maxAge)
  if (options.exposedHeaders) headers['access-control-expose-headers'] = options.exposedHeaders.join(', ')

  return headers
}
