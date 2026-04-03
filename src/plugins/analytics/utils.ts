/**
 * Shared utilities for the analytics subsystem.
 *
 * Helpers: rounding, header redaction, path matching, JSON safety.
 */

const REDACTED = '[REDACTED]'
const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
])

function shouldRedactSensitiveData(): boolean {
  return process.env.NODE_ENV === 'production'
}

export function redactHeaderValue(key: string, value: string): string {
  return shouldRedactSensitiveData() && SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? REDACTED : value
}

export function round(n: number): number {
  return Math.round(n * 100) / 100
}

export function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  headers.forEach((value, key) => {
    result[key] = redactHeaderValue(key, value)
  })
  return result
}

export function matchesPathPrefix(pathname: string, prefixes: Set<string>): boolean {
  const normalized = pathname.startsWith('/') ? pathname.slice(1) : pathname
  for (const prefix of prefixes) {
    if (normalized === prefix || normalized.startsWith(prefix + '/')) return true
  }
  return false
}

export function isTrackedRequestPath(pathname: string): boolean {
  const normalized = pathname.startsWith('/') ? pathname.slice(1) : pathname
  return (
    normalized === 'api' ||
    normalized.startsWith('api/') ||
    normalized === 'graphql' ||
    normalized.startsWith('graphql/')
  )
}

export function isAnalyticsPath(pathname: string): boolean {
  return pathname === 'api/analytics' || pathname.startsWith('api/analytics/')
}

/** Helper to safely cast unknown to Record. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
