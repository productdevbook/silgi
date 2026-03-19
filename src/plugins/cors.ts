/**
 * CORS plugin — v2 hook-based.
 *
 * Adds CORS headers to every response via lifecycle hooks.
 * Handles preflight OPTIONS requests automatically.
 */

import type { KatmanHooks } from '../katman.ts'

export interface CORSOptions {
  origin?: string | string[] | ((origin: string) => boolean)
  methods?: string[]
  allowedHeaders?: string[]
  exposedHeaders?: string[]
  credentials?: boolean
  maxAge?: number
}

/**
 * Create CORS hooks for katman().
 *
 * @example
 * ```ts
 * import { cors } from "katman/cors"
 *
 * const k = katman({
 *   context: (req) => ({}),
 *   hooks: cors({ origin: "https://app.example.com", credentials: true }),
 * })
 * ```
 */
export function cors(options: CORSOptions = {}): { headers: Record<string, string>; options: CORSOptions } {
  return {
    headers: corsHeaders(options),
    options,
  }
}

/**
 * CORS header map — use in custom serve() or middleware.
 * Returns headers object to merge into responses.
 */
export function corsHeaders(options: CORSOptions = {}, requestOrigin?: string): Record<string, string> {
  const origin = options.origin ?? '*'
  const methods = options.methods ?? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  const allowedHeaders = options.allowedHeaders ?? ['Content-Type', 'Authorization']

  const headers: Record<string, string> = {
    'access-control-allow-methods': methods.join(', '),
    'access-control-allow-headers': allowedHeaders.join(', '),
  }

  // Origin
  if (typeof origin === 'string') {
    headers['access-control-allow-origin'] = origin
  } else if (Array.isArray(origin)) {
    headers['access-control-allow-origin'] = requestOrigin && origin.includes(requestOrigin) ? requestOrigin : ''
    headers['vary'] = 'Origin'
  } else if (typeof origin === 'function' && requestOrigin) {
    headers['access-control-allow-origin'] = origin(requestOrigin) ? requestOrigin : ''
    headers['vary'] = 'Origin'
  }

  if (options.credentials) headers['access-control-allow-credentials'] = 'true'
  if (options.maxAge !== undefined) headers['access-control-max-age'] = String(options.maxAge)
  if (options.exposedHeaders) headers['access-control-expose-headers'] = options.exposedHeaders.join(', ')

  return headers
}
