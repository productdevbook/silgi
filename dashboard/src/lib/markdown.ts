import type { ErrorEntry } from './types'

const REDACTED = '[REDACTED]'
const SENSITIVE_HEADERS = new Set(['authorization', 'cookie', 'x-api-key'])

function redactHeader(key: string, value: string): string {
  return SENSITIVE_HEADERS.has(key.toLowerCase()) ? REDACTED : value
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

export function errorToMarkdown(entry: ErrorEntry): string {
  const lines: string[] = []
  const time = new Date(entry.timestamp).toISOString()

  lines.push(`## Error in \`${entry.procedure}\``)
  lines.push('')
  lines.push(`**Time:** ${time}  `)
  lines.push(`**Error:** ${entry.code}  `)
  lines.push(`**Status:** ${entry.status}  `)
  lines.push(`**Duration:** ${entry.durationMs}ms`)
  lines.push('')

  if (entry.input !== undefined && entry.input !== null) {
    lines.push('### Input', '', '```json', safeJson(entry.input), '```', '')
  }

  if (entry.stack) {
    lines.push('### Stack Trace', '', '```', entry.stack, '```', '')
  }

  const headerEntries = Object.entries(entry.headers ?? {})
  if (headerEntries.length > 0) {
    lines.push('### Request Headers', '')
    for (const [key, value] of headerEntries) {
      lines.push(`- \`${key}\`: \`${redactHeader(key, value)}\``)
    }
    lines.push('')
  }

  if (entry.spans.length > 0) {
    lines.push('### Traced Operations', '')
    lines.push('| Name | Duration | Status |')
    lines.push('|---|---|---|')
    for (const span of entry.spans) {
      const status = span.error ? `Error: ${span.error}` : 'OK'
      lines.push(`| ${span.name} | ${span.durationMs}ms | ${status} |`)
    }
    lines.push('')
  }

  lines.push('### Error Message', '', '```', entry.error, '```')

  return lines.join('\n')
}

export function errorToRedactedJson(entry: ErrorEntry): string {
  const redacted = {
    ...entry,
    headers: Object.fromEntries(
      Object.entries(entry.headers ?? {}).map(([k, v]) => [k, redactHeader(k, v)]),
    ),
  }
  return JSON.stringify(redacted, null, 2)
}
