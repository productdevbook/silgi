const REDACTED = '[REDACTED]'
const SENSITIVE_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
])

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname.endsWith('.localhost')
  )
}

export function shouldRedactSensitiveData(): boolean {
  if (typeof window !== 'undefined') {
    return !isLocalHostname(window.location.hostname)
  }

  return true
}

export function redactHeader(key: string, value: string): string {
  return shouldRedactSensitiveData() && SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value
}

export function isSensitiveHeader(key: string): boolean {
  return SENSITIVE_HEADERS.has(key.toLowerCase())
}
