/**
 * Built-in analytics plugin — zero-dependency monitoring with deep error tracing.
 *
 * - Per-procedure metrics (count, errors, latency percentiles) via ring buffers
 * - Full error log with input, headers, stack trace, custom spans
 * - `trace()` helper for measuring DB queries, API calls, etc.
 * - "Copy for AI" — one-click markdown export of any error
 *
 * Dashboard at /analytics, JSON API at /analytics/api, errors at /analytics/errors.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Ring Buffer (fixed memory, no GC pressure) ──────

class RingBuffer {
  #data: Float64Array
  #size: number
  #head = 0
  #count = 0

  constructor(size: number) {
    this.#data = new Float64Array(size)
    this.#size = size
  }

  push(value: number): void {
    this.#data[this.#head] = value
    this.#head = (this.#head + 1) % this.#size
    if (this.#count < this.#size) this.#count++
  }

  percentile(p: number): number {
    if (this.#count === 0) return 0
    const arr = new Float64Array(this.#count)
    if (this.#count < this.#size) {
      arr.set(this.#data.subarray(0, this.#count))
    } else {
      arr.set(this.#data)
    }
    arr.sort()
    const idx = Math.ceil((p / 100) * this.#count) - 1
    return arr[Math.max(0, idx)]!
  }

  avg(): number {
    if (this.#count === 0) return 0
    let sum = 0
    const n = this.#count
    for (let i = 0; i < n; i++) sum += this.#data[i]!
    return sum / n
  }

  get count(): number {
    return this.#count
  }
}

// ── Types ───────────────────────────────────────────

interface ProcedureEntry {
  count: number
  errors: number
  latencies: RingBuffer
  lastError: string | null
  lastErrorTime: number
}

interface TimeWindow {
  time: number
  count: number
  errors: number
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

export interface RequestEntry {
  id: number
  timestamp: number
  procedure: string
  durationMs: number
  status: number
  input: unknown
  spans: TraceSpan[]
}

export interface AnalyticsOptions {
  /** Latency samples to keep per procedure (default: 1024) */
  bufferSize?: number
  /** Time-series history in seconds (default: 120) */
  historySeconds?: number
  /** Max error entries to keep (default: 100) */
  maxErrors?: number
  /** Max recent request entries to keep (default: 200) */
  maxRequests?: number
  /**
   * Protect dashboard access.
   * - `string` — secret token checked against `Authorization: Bearer <token>` header or `?token=` query param
   * - `(req: Request) => boolean | Promise<boolean>` — custom auth function
   * - `undefined` — no auth (open access, NOT recommended in production)
   */
  auth?: string | ((req: Request) => boolean | Promise<boolean>)
}

export interface ProcedureSnapshot {
  count: number
  errors: number
  errorRate: number
  latency: { avg: number; p50: number; p95: number; p99: number }
  lastError: string | null
  lastErrorTime: number | null
}

export interface AnalyticsSnapshot {
  uptime: number
  totalRequests: number
  totalErrors: number
  errorRate: number
  requestsPerSecond: number
  avgLatency: number
  procedures: Record<string, ProcedureSnapshot>
  timeSeries: TimeWindow[]
}

// ── Request Trace (per-request span collector) ──────

export class RequestTrace {
  spans: TraceSpan[] = []

  /**
   * Wrap an async operation and record its duration.
   *
   * ```ts
   * const users = await ctx.trace('db.users.find', () => db.users.findMany())
   * const weather = await ctx.trace('api.weather', () => fetch(url))
   * ```
   */
  async trace<T>(name: string, fn: () => T | Promise<T>): Promise<T> {
    const t0 = performance.now()
    try {
      const result = await fn()
      this.spans.push({ name, durationMs: round(performance.now() - t0) })
      return result
    } catch (err) {
      this.spans.push({
        name,
        durationMs: round(performance.now() - t0),
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}

/**
 * Standalone trace function — works with or without analytics.
 *
 * When analytics is enabled, records the span. When disabled, just runs the function.
 *
 * ```ts
 * import { trace } from 'silgi/analytics'
 *
 * const listUsers = s.$resolve(async ({ ctx }) => {
 *   return await trace(ctx, 'db.users.findMany', () => db.users.findMany())
 * })
 * ```
 */
export async function trace<T>(ctx: Record<string, unknown>, name: string, fn: () => T | Promise<T>): Promise<T> {
  const reqTrace = ctx.__analyticsTrace as RequestTrace | undefined
  if (reqTrace) {
    return reqTrace.trace(name, fn)
  }
  return fn()
}

// ── Collector ───────────────────────────────────────

export class AnalyticsCollector {
  #procedures = new Map<string, ProcedureEntry>()
  #startTime = Date.now()
  #totalRequests = 0
  #totalErrors = 0
  #bufferSize: number
  #historySeconds: number
  #maxErrors: number
  #maxRequests: number

  // 1-second time windows for sparklines
  #timeSeries: TimeWindow[] = []
  #currentWindow: TimeWindow

  // Error log
  #errors: ErrorEntry[] = []
  #nextErrorId = 1

  // Recent requests log (all requests with spans)
  #requests: RequestEntry[] = []
  #nextRequestId = 1

  constructor(options: AnalyticsOptions = {}) {
    this.#bufferSize = options.bufferSize ?? 1024
    this.#historySeconds = options.historySeconds ?? 120
    this.#maxErrors = options.maxErrors ?? 100
    this.#maxRequests = options.maxRequests ?? 200
    this.#currentWindow = { time: Math.floor(Date.now() / 1000), count: 0, errors: 0 }
  }

  record(path: string, durationMs: number): void {
    this.#totalRequests++
    const entry = this.#getOrCreate(path)
    entry.count++
    entry.latencies.push(durationMs)
    this.#tick(false)
  }

  recordError(path: string, durationMs: number, errorMsg: string): void {
    this.#totalRequests++
    this.#totalErrors++
    const entry = this.#getOrCreate(path)
    entry.count++
    entry.errors++
    entry.latencies.push(durationMs)
    entry.lastError = errorMsg
    entry.lastErrorTime = Date.now()
    this.#tick(true)
  }

  /** Record a detailed error with full context for the error log + AI export. */
  recordDetailedError(entry: Omit<ErrorEntry, 'id'>): void {
    this.#errors.push({ ...entry, id: this.#nextErrorId++ })
    if (this.#errors.length > this.#maxErrors) {
      this.#errors.shift()
    }
  }

  /** Record a detailed request (successful or not) with trace spans. */
  recordDetailedRequest(entry: Omit<RequestEntry, 'id'>): void {
    this.#requests.push({ ...entry, id: this.#nextRequestId++ })
    if (this.#requests.length > this.#maxRequests) {
      this.#requests.shift()
    }
  }

  #getOrCreate(path: string): ProcedureEntry {
    let entry = this.#procedures.get(path)
    if (!entry) {
      entry = {
        count: 0,
        errors: 0,
        latencies: new RingBuffer(this.#bufferSize),
        lastError: null,
        lastErrorTime: 0,
      }
      this.#procedures.set(path, entry)
    }
    return entry
  }

  #tick(isError: boolean): void {
    const now = Math.floor(Date.now() / 1000)
    if (now !== this.#currentWindow.time) {
      if (this.#currentWindow.count > 0) {
        this.#timeSeries.push({ ...this.#currentWindow })
        if (this.#timeSeries.length > this.#historySeconds) {
          this.#timeSeries.shift()
        }
      }
      this.#currentWindow = { time: now, count: 0, errors: 0 }
    }
    this.#currentWindow.count++
    if (isError) this.#currentWindow.errors++
  }

  getErrors(): ErrorEntry[] {
    return this.#errors
  }

  getRequests(): RequestEntry[] {
    return this.#requests
  }

  toJSON(): AnalyticsSnapshot {
    const uptimeSeconds = (Date.now() - this.#startTime) / 1000
    const procedures: Record<string, ProcedureSnapshot> = {}

    let totalLatencySum = 0
    let totalLatencyCount = 0

    for (const [path, entry] of this.#procedures) {
      const avg = entry.latencies.avg()
      procedures[path] = {
        count: entry.count,
        errors: entry.errors,
        errorRate: entry.count > 0 ? round((entry.errors / entry.count) * 100) : 0,
        latency: {
          avg: round(avg),
          p50: round(entry.latencies.percentile(50)),
          p95: round(entry.latencies.percentile(95)),
          p99: round(entry.latencies.percentile(99)),
        },
        lastError: entry.lastError,
        lastErrorTime: entry.lastErrorTime || null,
      }
      totalLatencySum += avg * entry.latencies.count
      totalLatencyCount += entry.latencies.count
    }

    return {
      uptime: Math.round(uptimeSeconds),
      totalRequests: this.#totalRequests,
      totalErrors: this.#totalErrors,
      errorRate: this.#totalRequests > 0 ? round((this.#totalErrors / this.#totalRequests) * 100) : 0,
      requestsPerSecond: uptimeSeconds > 0 ? round(this.#totalRequests / uptimeSeconds) : 0,
      avgLatency: totalLatencyCount > 0 ? round(totalLatencySum / totalLatencyCount) : 0,
      procedures,
      timeSeries: this.#currentWindow.count > 0 ? [...this.#timeSeries, this.#currentWindow] : [...this.#timeSeries],
    }
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

// ── Markdown Export ─────────────────────────────────

export function errorToMarkdown(e: ErrorEntry): string {
  const time = new Date(e.timestamp).toISOString()
  const inputJson = safeStringify(e.input)

  let md = `## Error in \`${e.procedure}\`\n\n`
  md += `**Time:** ${time}  \n`
  md += `**Error:** ${e.code}  \n`
  md += `**Status:** ${e.status}  \n`
  md += `**Duration:** ${e.durationMs}ms\n\n`

  if (e.input !== undefined) {
    md += `### Input\n\n\`\`\`json\n${inputJson}\n\`\`\`\n\n`
  }

  if (e.stack) {
    md += `### Stack Trace\n\n\`\`\`\n${e.stack}\n\`\`\`\n\n`
  }

  if (Object.keys(e.headers).length > 0) {
    md += `### Request Headers\n\n`
    for (const [k, v] of Object.entries(e.headers)) {
      if (k === 'authorization') md += `- \`${k}\`: \`[REDACTED]\`\n`
      else md += `- \`${k}\`: \`${v}\`\n`
    }
    md += '\n'
  }

  if (e.spans.length > 0) {
    md += `### Traced Operations\n\n`
    md += `| Name | Duration | Status |\n|---|---|---|\n`
    for (const s of e.spans) {
      md += `| ${s.name} | ${s.durationMs}ms | ${s.error ? `Error: ${s.error}` : 'OK'} |\n`
    }
    md += '\n'
  }

  md += `### Error Message\n\n\`\`\`\n${e.error}\n\`\`\``
  return md
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// ── Dashboard HTML (runtime read from lib/dashboard/index.html) ──

const __analytics_dirname = dirname(fileURLToPath(import.meta.url))

let _dashboardCache: string | undefined

export function analyticsHTML(): string {
  if (_dashboardCache) return _dashboardCache

  // Resolve relative to this file — works in both source (src/plugins/) and dist (dist/plugins/)
  const candidates = [
    resolve(__analytics_dirname, '../../lib/dashboard/index.html'),
    resolve(__analytics_dirname, '../lib/dashboard/index.html'),
    resolve(__analytics_dirname, '../../../lib/dashboard/index.html'),
  ]

  for (const p of candidates) {
    try {
      _dashboardCache = readFileSync(p, 'utf-8')
      return _dashboardCache
    } catch {
      // try next
    }
  }

  return FALLBACK_HTML
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Silgi Analytics</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.msg{text-align:center}.msg h1{color:#edc462;margin-bottom:8px}.msg p{color:#71717a;font-size:14px}</style></head>
<body><div class="msg"><h1>silgi analytics</h1><p>Dashboard not built. Run <code>pnpm build:dashboard</code></p></div></body></html>`
