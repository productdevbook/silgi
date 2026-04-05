import type { ErrorEntry, ProcedureCall, RequestEntry, TaskExecution, TraceSpan } from './types'
import { redactHeader } from './privacy'

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function toCurlValue(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function getAnalyticsOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function analyticsMarkdownCurl(url: string): string {
  return ['```bash', `curl -L ${toCurlValue(url)} \\`, `  -H 'accept: text/markdown'`, '```'].join('\n')
}

// ── Spans markdown ──

function spansToMarkdown(spans: TraceSpan[], totalMs: number): string {
  if (spans.length === 0) return ''

  const lines: string[] = []
  const byKind = new Map<string, number>()
  for (const s of spans) {
    byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
  }
  const tracedMs = [...byKind.values()].reduce((a, b) => a + b, 0)
  const appMs = Math.max(0, totalMs - tracedMs)
  const total = Math.max(totalMs, 0.1)

  lines.push('#### Timing')
  lines.push('')
  lines.push('| Category | Duration | % |')
  lines.push('|----------|----------|---|')
  lines.push(`| **Total** | **${totalMs}ms** | 100% |`)
  for (const [kind, ms] of byKind) {
    lines.push(`| ${kind} | ${ms.toFixed(1)}ms | ${((ms / total) * 100).toFixed(0)}% |`)
  }
  lines.push(`| App Logic | ${appMs.toFixed(1)}ms | ${((appMs / total) * 100).toFixed(0)}% |`)
  lines.push('')

  for (let i = 0; i < spans.length; i++) {
    const s = spans[i]!
    const errMark = s.error ? ` ❌ ${s.error}` : ''
    const offset = s.startOffsetMs != null ? ` (at +${s.startOffsetMs}ms)` : ''
    lines.push(`**${i + 1}. [${s.kind}] ${s.name}** — ${s.durationMs}ms${offset}${errMark}`)
    if (s.detail) {
      lines.push('```', s.detail, '```')
    }
  }
  lines.push('')
  return lines.join('\n')
}

function procedureToMarkdown(p: ProcedureCall, idx: number): string {
  const lines: string[] = []
  const emoji = p.status >= 500 ? '💥' : p.status >= 400 ? '⚠️' : '✅'
  lines.push(`### ${emoji} ${idx + 1}. \`${p.procedure}\` → ${p.status} (${p.durationMs}ms)`)
  lines.push('')

  if (p.input !== undefined && p.input !== null) {
    lines.push('#### Input', '', '```json', safeJson(p.input), '```', '')
  }
  if (p.output !== undefined && p.output !== null) {
    lines.push('#### Output', '', '```json', safeJson(p.output), '```', '')
  }
  if (p.error) {
    lines.push(`#### Error`, '', '```', p.error, '```', '')
  }

  lines.push(spansToMarkdown(p.spans, p.durationMs))
  return lines.join('\n')
}

function aiPrompt(totalMs: number): string {
  const lines: string[] = []
  lines.push('---', '')
  lines.push('**Analyze this request and suggest performance optimizations:**')
  lines.push('- Redundant or slow operations that could be combined?')
  lines.push('- N+1 query pattern?')
  lines.push('- Data that should be cached?')
  lines.push('- Sequential calls that could run in parallel?')
  if (totalMs > 100) {
    lines.push(`- This request took ${totalMs}ms — what is the bottleneck?`)
  }
  return lines.join('\n')
}

// ── Error markdown ──

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

  lines.push(spansToMarkdown(entry.spans, entry.durationMs))
  lines.push('### Error Message', '', '```', entry.error, '```', '')
  lines.push(aiPrompt(entry.durationMs))

  return lines.join('\n')
}

export function errorToRedactedJson(entry: ErrorEntry): string {
  const redacted = {
    ...entry,
    headers: Object.fromEntries(Object.entries(entry.headers ?? {}).map(([k, v]) => [k, redactHeader(k, v)])),
  }
  return JSON.stringify(redacted, null, 2)
}

// ── Request markdown (HTTP-level with procedures) ──

export function requestToMarkdown(entry: RequestEntry): string {
  const lines: string[] = []
  const time = new Date(entry.timestamp).toISOString()
  const emoji = entry.status >= 500 ? '💥' : entry.status >= 400 ? '⚠️' : '✅'

  lines.push(`## ${emoji} ${entry.method} ${entry.path} → ${entry.status} (${entry.durationMs}ms)`)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('|-------|-------|')
  lines.push(`| Request ID | \`${entry.requestId}\` |`)
  lines.push(`| Session ID | \`${entry.sessionId}\` |`)
  lines.push(`| Method | ${entry.method} |`)
  lines.push(`| URL | \`${entry.url}\` |`)
  lines.push(`| Path | \`${entry.path}\` |`)
  lines.push(`| Status | ${entry.status} |`)
  lines.push(`| Duration | ${entry.durationMs}ms |`)
  lines.push(`| Time | ${time} |`)
  lines.push(`| IP | ${entry.ip} |`)
  lines.push(`| Procedures | ${entry.procedures.length} |`)
  if (entry.isBatch) lines.push(`| Batch | Yes |`)
  lines.push('')

  // Headers
  const headerEntries = Object.entries(entry.headers ?? {})
  if (headerEntries.length > 0) {
    lines.push('### Request Headers', '')
    for (const [key, value] of headerEntries) {
      lines.push(`- \`${key}\`: \`${redactHeader(key, value)}\``)
    }
    lines.push('')
  }

  // Procedures
  for (let i = 0; i < entry.procedures.length; i++) {
    lines.push(procedureToMarkdown(entry.procedures[i]!, i))
  }

  // Response headers
  const resHeaders = Object.entries(entry.responseHeaders ?? {})
  if (resHeaders.length > 0) {
    lines.push('### Response Headers', '')
    for (const [key, value] of resHeaders) {
      lines.push(`- \`${key}\`: \`${value}\``)
    }
    lines.push('')
  }

  lines.push(aiPrompt(entry.durationMs))
  return lines.join('\n')
}

export function requestTimingMarkdown(entry: RequestEntry): string {
  const lines: string[] = []
  lines.push(`## Performance: ${entry.method} ${entry.path} → ${entry.status} (${entry.durationMs}ms)`)
  lines.push('')

  for (let i = 0; i < entry.procedures.length; i++) {
    const p = entry.procedures[i]!
    lines.push(`### ${i + 1}. \`${p.procedure}\` (${p.durationMs}ms)`)
    lines.push('')
    lines.push(spansToMarkdown(p.spans, p.durationMs))
  }

  lines.push(aiPrompt(entry.durationMs))
  return lines.join('\n')
}

export function requestMarkdownUrl(entry: RequestEntry): string {
  const id = encodeURIComponent(entry.requestId || String(entry.id))
  return `${getAnalyticsOrigin()}/api/analytics/requests/${id}/md`
}

export function requestMarkdownCurl(entry: RequestEntry): string {
  return analyticsMarkdownCurl(requestMarkdownUrl(entry))
}

export function errorMarkdownUrl(entry: ErrorEntry): string {
  return `${getAnalyticsOrigin()}/api/analytics/errors/${encodeURIComponent(String(entry.id))}/md`
}

export function errorMarkdownCurl(entry: ErrorEntry): string {
  return analyticsMarkdownCurl(errorMarkdownUrl(entry))
}

export function requestToRedactedJson(entry: RequestEntry): string {
  const redacted = {
    ...entry,
    headers: Object.fromEntries(Object.entries(entry.headers ?? {}).map(([k, v]) => [k, redactHeader(k, v)])),
    responseHeaders: Object.fromEntries(
      Object.entries(entry.responseHeaders ?? {}).map(([k, v]) => [k, redactHeader(k, v)]),
    ),
  }
  return JSON.stringify(redacted, null, 2)
}

// ── Session markdown ──

export function sessionToMarkdown(requests: RequestEntry[], sessionId: string): string {
  const lines: string[] = []
  const sorted = [...requests].toSorted((a, b) => a.timestamp - b.timestamp)
  const first = sorted[0]!
  const last = sorted[sorted.length - 1]!
  const totalMs = requests.reduce((sum, r) => sum + r.durationMs, 0)
  const errorCount = requests.filter((r) => r.status >= 400).length
  const uniqueProcs = new Set(requests.flatMap((r) => r.procedures.map((p) => p.procedure)))

  lines.push(`## Session \`${sessionId}\``)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('|-------|-------|')
  lines.push(`| Requests | ${requests.length} |`)
  lines.push(`| Errors | ${errorCount} |`)
  lines.push(`| Total Duration | ${totalMs.toFixed(1)}ms |`)
  lines.push(`| Avg Duration | ${(totalMs / requests.length).toFixed(1)}ms |`)
  lines.push(`| First Seen | ${new Date(first.timestamp).toISOString()} |`)
  lines.push(`| Last Seen | ${new Date(last.timestamp).toISOString()} |`)
  lines.push(`| Procedures | ${[...uniqueProcs].join(', ')} |`)
  lines.push(`| IP | ${last.ip} |`)
  lines.push('')

  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i]!
    const emoji = r.status >= 500 ? '💥' : r.status >= 400 ? '⚠️' : '✅'
    lines.push(`### ${emoji} ${i + 1}. ${r.method} ${r.path} → ${r.status} (${r.durationMs}ms)`)
    lines.push('')
    for (const p of r.procedures) {
      lines.push(`- \`${p.procedure}\` — ${p.status} — ${p.durationMs}ms — ${p.spans.length} spans`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

export function sessionToRedactedJson(requests: RequestEntry[], sessionId: string): string {
  const redacted = requests.map((r) => ({
    ...r,
    headers: Object.fromEntries(Object.entries(r.headers ?? {}).map(([k, v]) => [k, redactHeader(k, v)])),
    responseHeaders: Object.fromEntries(
      Object.entries(r.responseHeaders ?? {}).map(([k, v]) => [k, redactHeader(k, v)]),
    ),
  }))
  return JSON.stringify({ sessionId, requests: redacted }, null, 2)
}

export function taskToMarkdown(entry: TaskExecution): string {
  const lines: string[] = []
  const time = new Date(entry.timestamp).toISOString()
  const emoji = entry.status === 'error' ? '💥' : '✅'

  lines.push(`## ${emoji} Task \`${entry.taskName || '(unnamed)'}\``)
  lines.push('')
  lines.push('| Field | Value |')
  lines.push('|-------|-------|')
  lines.push(`| Status | ${entry.status} |`)
  lines.push(`| Trigger | ${entry.trigger} |`)
  lines.push(`| Duration | ${entry.durationMs}ms |`)
  lines.push(`| Time | ${time} |`)
  lines.push(`| Spans | ${entry.spans.length} |`)
  lines.push('')

  if (entry.input !== undefined && entry.input !== null) {
    lines.push('### Input', '', '```json', safeJson(entry.input), '```', '')
  }
  if (entry.output !== undefined && entry.output !== null) {
    lines.push('### Output', '', '```json', safeJson(entry.output), '```', '')
  }
  if (entry.error) {
    lines.push('### Error', '', '```', entry.error, '```', '')
  }
  if (entry.spans.length > 0) {
    lines.push(spansToMarkdown(entry.spans, entry.durationMs))
  }

  return lines.join('\n')
}
