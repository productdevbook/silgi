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

export function redactHeaderValue(key: string, value: string): string {
  return SENSITIVE_HEADER_KEYS.has(key.toLowerCase()) ? REDACTED : value
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

/**
 * Normalize an incoming path to its analytics sub-path.
 *
 * Returns the sub-path after `analytics/` (e.g. `'stats'`, `'requests/5'`),
 * an empty string for the dashboard root, or `null` if this isn't an
 * analytics path at all.
 *
 * Accepts both `api/analytics*` (mounted under an `/api` RPC prefix) and
 * bare `analytics*` (mounted at a prefix that already ends with `/api`),
 * so the dashboard works regardless of adapter prefix configuration.
 */
export function normalizeAnalyticsPath(pathname: string): string | null {
  const p = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  if (p === 'api/analytics') return ''
  if (p.startsWith('api/analytics/')) return p.slice('api/analytics/'.length)
  if (p === 'analytics') return ''
  if (p.startsWith('analytics/')) return p.slice('analytics/'.length)
  return null
}

export function isAnalyticsPath(pathname: string): boolean {
  return normalizeAnalyticsPath(pathname) !== null
}

/** Helper to safely cast unknown to Record. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
