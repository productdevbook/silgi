/**
 * Shared dispatch utilities for adapters.
 *
 * Centralizes: context building, method enforcement, input parsing, error serialization.
 * Every non-Fetch adapter (express, nestjs, bun, lambda, message-port) uses these
 * instead of reimplementing the same logic.
 */

import { SilgiError, toSilgiError } from './error.ts'
import { ValidationError } from './schema.ts'

// ── Context Building ────────────────────────────────

/**
 * Copy properties from source into target context via direct property set.
 * V8 monomorphic access — no Object.assign, no spread.
 */
export function applyContext(target: Record<string, unknown>, source: Record<string, unknown>): void {
  const keys = Object.keys(source)
  for (let i = 0; i < keys.length; i++) target[keys[i]!] = source[keys[i]!]
}

/**
 * Build a null-prototype context object from a base context and route params.
 * Uses direct property assignment (no Object.assign) for V8 monomorphic access.
 */
export function buildContext(
  baseCtx: Record<string, unknown> | null | undefined,
  params: Record<string, string> | undefined,
): Record<string, unknown> {
  const ctx: Record<string, unknown> = Object.create(null)
  if (baseCtx) applyContext(ctx, baseCtx)
  if (params) ctx.params = params
  return ctx
}

// ── Method Enforcement ──────────────────────────────

/** Check if an HTTP method is allowed for a compiled route. */
export function isMethodAllowed(reqMethod: string, routeMethod: string): boolean {
  if (routeMethod === '*') return true
  if (reqMethod === routeMethod) return true
  if (reqMethod === 'OPTIONS') return true
  if (reqMethod === 'GET' && routeMethod === 'POST') return true
  return false
}

// ── Error Serialization ─────────────────────────────

export interface ErrorBody {
  code: string
  status: number
  message: string
  data?: unknown
}

/** Convert any thrown error to a serializable error body + status. */
export function serializeError(error: unknown): ErrorBody {
  if (error instanceof ValidationError) {
    return { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
  }
  const e = error instanceof SilgiError ? error : toSilgiError(error)
  return e.toJSON()
}

// ── Query Input Parsing ─────────────────────────────

/** Max allowed size for GET ?data= parameter (bytes). Prevents JSON bomb via URL. */
const MAX_QUERY_DATA_LENGTH = 8192

/**
 * Parse a JSON string from a query parameter.
 * Throws SilgiError(BAD_REQUEST) on invalid JSON or oversized input.
 */
export function parseQueryData(dataValue: string): unknown {
  if (dataValue.length > MAX_QUERY_DATA_LENGTH) {
    throw new SilgiError('BAD_REQUEST', { message: 'Query data parameter too large' })
  }
  try {
    return JSON.parse(dataValue)
  } catch {
    throw new SilgiError('BAD_REQUEST', { message: 'Invalid JSON in data parameter' })
  }
}
