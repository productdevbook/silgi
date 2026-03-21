import { useCallback, useEffect, useRef, useState } from 'react'

export interface ProcedureSnapshot {
  count: number
  errors: number
  errorRate: number
  latency: { avg: number; p50: number; p95: number; p99: number }
  lastError: string | null
  lastErrorTime: number | null
}

export interface TimeWindow {
  time: number
  count: number
  errors: number
}

export interface AnalyticsData {
  uptime: number
  totalRequests: number
  totalErrors: number
  errorRate: number
  requestsPerSecond: number
  avgLatency: number
  procedures: Record<string, ProcedureSnapshot>
  timeSeries: TimeWindow[]
}

export interface TraceSpan {
  name: string
  durationMs: number
  error?: string
}

export interface ErrorEntry {
  id: number
  timestamp: number
  procedure: string
  error: string
  code: string
  status: number
  stack: string
  input: unknown
  headers: Record<string, string>
  durationMs: number
  spans: TraceSpan[]
}

export function useAnalytics(intervalMs = 2000) {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [errors, setErrors] = useState<ErrorEntry[]>([])
  const [autoRefresh, setAutoRefresh] = useState(true)

  const poll = useCallback(async () => {
    try {
      const [apiRes, errRes] = await Promise.all([fetch('/analytics/api'), fetch('/analytics/errors')])
      if (apiRes.ok) setData(await apiRes.json())
      if (errRes.ok) setErrors(await errRes.json())
    } catch {
      // Server unreachable
    }
  }, [])

  useEffect(() => {
    poll()
    if (!autoRefresh) return
    const id = setInterval(poll, intervalMs)
    return () => clearInterval(id)
  }, [poll, intervalMs, autoRefresh])

  return { data, errors, autoRefresh, setAutoRefresh }
}

// ── Formatting helpers ──────────────────────────────

export function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

export function fmtMs(n: number): string {
  if (n < 1) return `${n.toFixed(2)}ms`
  if (n < 1000) return `${n.toFixed(1)}ms`
  return `${(n / 1000).toFixed(1)}s`
}

export function fmtUptime(s: number): string {
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function fmtTime(ts: number): string {
  const d = new Date(ts)
  return `${d.toLocaleTimeString()}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

// ── Markdown export ─────────────────────────────────

export function errorToMarkdown(e: ErrorEntry): string {
  const time = new Date(e.timestamp).toISOString()
  let md = `## Error in \`${e.procedure}\`\n\n`
  md += `**Time:** ${time}  \n`
  md += `**Error:** ${e.code}  \n`
  md += `**Status:** ${e.status}  \n`
  md += `**Duration:** ${e.durationMs}ms\n\n`

  if (e.input !== undefined && e.input !== null) {
    md += `### Input\n\n\`\`\`json\n${JSON.stringify(e.input, null, 2)}\n\`\`\`\n\n`
  }

  if (e.stack) {
    md += `### Stack Trace\n\n\`\`\`\n${e.stack}\n\`\`\`\n\n`
  }

  const hdrKeys = Object.keys(e.headers || {})
  if (hdrKeys.length > 0) {
    md += `### Request Headers\n\n`
    for (const k of hdrKeys) {
      const v = k === 'authorization' ? '[REDACTED]' : e.headers[k]
      md += `- \`${k}\`: \`${v}\`\n`
    }
    md += '\n'
  }

  if (e.spans.length > 0) {
    md += `### Traced Operations\n\n| Name | Duration | Status |\n|---|---|---|\n`
    for (const s of e.spans) {
      md += `| ${s.name} | ${s.durationMs}ms | ${s.error ? `Error: ${s.error}` : 'OK'} |\n`
    }
    md += '\n'
  }

  md += `### Error Message\n\n\`\`\`\n${e.error}\n\`\`\``
  return md
}

// ── Copy helper ─────────────────────────────────────

export function useCopy() {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const copy = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopiedId(null), 2000)
    })
  }, [])

  return { copiedId, copy }
}
