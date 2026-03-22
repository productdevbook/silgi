/**
 * Built-in analytics plugin — zero-dependency monitoring with deep error tracing.
 *
 * - Per-procedure metrics (count, errors, latency percentiles) via ring buffers
 * - Full error log with input, headers, stack trace, custom spans
 * - `trace()` helper for measuring DB queries, API calls, etc.
 * - "Copy for AI" — one-click markdown export of any error
 * - HTTP-level request tracking with procedure grouping (batch support)
 * - Unique request IDs via `x-request-id` response header
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

export type SpanKind = 'db' | 'http' | 'cache' | 'queue' | 'email' | 'ai' | 'custom'

export interface TraceSpan {
  name: string
  kind: SpanKind
  durationMs: number
  startOffsetMs?: number
  detail?: string
  input?: unknown
  output?: unknown
  error?: string
}

export interface ErrorEntry {
  id: number
  /** Links back to the RequestEntry that produced this error. */
  requestId: string
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

/** A single procedure call within an HTTP request. */
export interface ProcedureCall {
  procedure: string
  durationMs: number
  status: number
  input: unknown
  output: unknown
  spans: TraceSpan[]
  error?: string
}

/** An HTTP request containing one or more procedure calls. */
export interface RequestEntry {
  id: number
  /** Unique request ID (returned in x-request-id response header). */
  requestId: string
  /** Persistent session ID (from cookie — survives browser restart). */
  sessionId: string
  timestamp: number
  durationMs: number
  method: string
  path: string
  ip: string
  headers: Record<string, string>
  responseHeaders: Record<string, string>
  userAgent: string
  status: number
  procedures: ProcedureCall[]
  isBatch: boolean
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

// ── Request ID Generator (Snowflake-style) ──────────
//
// Layout: 42-bit timestamp (ms) | 12-bit counter | 10-bit random
// - 42 bits timestamp → ~139 years from epoch
// - 12 bits counter → 4096 IDs per ms (supports 4M req/sec)
// - 10 bits random → collision resistance across processes
//
// Encoded as Base36 → 13 characters, lexicographically time-sorted
// Speed: ~50ns (Date.now + Math.random, no crypto)
//
// References:
// - Twitter Snowflake (2010): 41-bit ts | 10-bit machine | 12-bit seq
// - RFC 9562 UUID v7: 48-bit ts | 74-bit random
// - arXiv:2509.08969 — ULID vs UUID v7 comparative analysis

let _lastTime = 0
let _counter = 0

function generateRequestId(): string {
  let now = Date.now()

  if (now === _lastTime) {
    _counter = (_counter + 1) & 0xFFF // 12 bits = 4096 per ms
    if (_counter === 0) {
      // Counter overflow — busy-wait to next ms (only at >4M req/sec)
      while (now === _lastTime) now = Date.now()
    }
  } else {
    _counter = 0
    _lastTime = now
  }

  // Pack: timestamp(42) | counter(12) | random(10) into two 32-bit halves
  // High: upper 32 bits of timestamp
  // Low: lower 10 bits of timestamp | 12-bit counter | 10-bit random
  const high = Math.floor(now / 1024) // upper 32 bits (ts >> 10)
  const low = ((now & 0x3FF) << 22) | (_counter << 10) | ((Math.random() * 1024) >>> 0)

  return high.toString(36) + low.toString(36).padStart(7, '0')
}

// ── Request Trace (per-request span collector) ──────

export class RequestTrace {
  spans: TraceSpan[] = []
  /** Procedure-level input — set via `setProcedureInput()` or `trace(..., { procedure: { input } })` */
  procedureInput: unknown = undefined
  /** Procedure-level output — set via `setProcedureOutput()` or `trace(..., { procedure: { output } })` */
  procedureOutput: unknown = undefined
  #t0 = performance.now()

  async trace<T>(name: string, fn: () => T | Promise<T>, opts?: { kind?: SpanKind; detail?: string; input?: unknown; output?: unknown | ((result: T) => unknown); procedure?: { input?: unknown; output?: unknown | ((result: T) => unknown) } }): Promise<T> {
    const start = performance.now()
    const kind = opts?.kind ?? guessKind(name)
    try {
      const result = await fn()
      this.spans.push({
        name,
        kind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - this.#t0),
        detail: opts?.detail,
        input: opts?.input,
        output: typeof opts?.output === 'function' ? (opts.output as (r: T) => unknown)(result) : opts?.output,
      })
      // Write procedure-level data if provided
      if (opts?.procedure) {
        if (opts.procedure.input !== undefined) this.procedureInput = opts.procedure.input
        const po = opts.procedure.output
        if (po !== undefined) this.procedureOutput = typeof po === 'function' ? (po as (r: T) => unknown)(result) : po
      }
      return result
    } catch (err) {
      this.spans.push({
        name,
        kind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - this.#t0),
        detail: opts?.detail,
        input: opts?.input,
        error: err instanceof Error ? err.message : String(err),
      })
      if (opts?.procedure?.input !== undefined) this.procedureInput = opts.procedure.input
      throw err
    }
  }

  totalByKind(kind: SpanKind): number {
    let total = 0
    for (const s of this.spans) {
      if (s.kind === kind) total += s.durationMs
    }
    return round(total)
  }
}

function guessKind(name: string): SpanKind {
  const lower = name.toLowerCase()
  if (lower.startsWith('db.') || lower.includes('sql') || lower.includes('prisma') || lower.includes('drizzle') || lower.includes('query') || lower.includes('mongo'))
    return 'db'
  if (lower.startsWith('http.') || lower.includes('fetch') || lower.includes('api.'))
    return 'http'
  if (lower.startsWith('cache.') || lower.includes('redis') || lower.includes('memcache'))
    return 'cache'
  if (lower.includes('queue') || lower.includes('publish') || lower.includes('nats') || lower.includes('kafka'))
    return 'queue'
  if (lower.includes('email') || lower.includes('smtp') || lower.includes('ses'))
    return 'email'
  if (lower.includes('ai') || lower.includes('llm') || lower.includes('openai') || lower.includes('gemini'))
    return 'ai'
  return 'custom'
}

/**
 * Standalone trace function — works with or without analytics.
 *
 * ```ts
 * import { trace } from 'silgi/analytics'
 *
 * const listUsers = s.$resolve(async ({ ctx }) => {
 *   return await trace(ctx, 'db.users.findMany', () => db.users.findMany())
 *   // or with explicit kind:
 *   return await trace(ctx, 'findUsers', () => db.users.findMany(), { kind: 'db', detail: 'SELECT * FROM users' })
 * })
 * ```
 */
export async function trace<T>(ctx: Record<string, unknown>, name: string, fn: () => T | Promise<T>, opts?: { kind?: SpanKind; detail?: string; input?: unknown; output?: unknown | ((result: T) => unknown); procedure?: { input?: unknown; output?: unknown | ((result: T) => unknown) } }): Promise<T> {
  const reqTrace = ctx.__analyticsTrace as RequestTrace | undefined
  if (reqTrace) {
    return reqTrace.trace(name, fn, opts)
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
  #timeSeries: TimeWindow[] = []
  #currentWindow: TimeWindow
  #errors: ErrorEntry[] = []
  #nextErrorId = 1
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

  recordDetailedError(entry: Omit<ErrorEntry, 'id'>): void {
    this.#errors.push({ ...entry, id: this.#nextErrorId++ })
    if (this.#errors.length > this.#maxErrors) {
      this.#errors.shift()
    }
  }

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

// ── Request Accumulator (HTTP-level grouping) ───────

/**
 * Collects procedure calls within a single HTTP request.
 * Created at the start of handleRequest, procedures are added as they complete,
 * then flushed to the collector at the end.
 *
 * Sets `x-request-id` response header automatically.
 */
const SESSION_COOKIE = '_sid'
const SESSION_MAX_AGE = 365 * 24 * 60 * 60 // 1 year

export class RequestAccumulator {
  readonly requestId: string
  readonly sessionId: string
  /** True if a new session cookie needs to be set. */
  readonly isNewSession: boolean
  #t0: number
  #request: Request
  #procedures: ProcedureCall[] = []
  #collector: AnalyticsCollector

  constructor(request: Request, collector: AnalyticsCollector) {
    this.requestId = generateRequestId()
    this.#t0 = performance.now()
    this.#request = request
    this.#collector = collector

    // Read or generate session ID from cookie
    const existing = parseCookie(request.headers.get('cookie'), SESSION_COOKIE)
    if (existing && existing.length >= 10) {
      this.sessionId = existing
      this.isNewSession = false
    } else {
      this.sessionId = generateRequestId() // same Snowflake format — unique, time-sorted
      this.isNewSession = true
    }
  }

  addProcedure(call: ProcedureCall): void {
    this.#procedures.push(call)
  }

  /** Get Set-Cookie header value (only if new session). */
  getSessionCookie(): string | null {
    if (!this.isNewSession) return null
    return `${SESSION_COOKIE}=${this.sessionId}; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax; HttpOnly`
  }

  /** Flush with response headers extracted from the actual Response object. */
  flushWithResponse(res: Response): void {
    if (this.#procedures.length === 0) return

    const durationMs = round(performance.now() - this.#t0)
    const headers: Record<string, string> = {}
    this.#request.headers.forEach((v, k) => {
      headers[k] = k === 'authorization' || k === 'cookie' ? '[REDACTED]' : v
    })

    // Capture actual response headers
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      // Skip cookie values from response headers for privacy
      responseHeaders[k] = k === 'set-cookie' ? '[REDACTED]' : v
    })

    let worstStatus = 200
    for (const p of this.#procedures) {
      if (p.status > worstStatus) worstStatus = p.status
    }

    // Extract path without URL parsing (fast)
    const url = this.#request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const path = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)

    this.#collector.recordDetailedRequest({
      requestId: this.requestId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      durationMs,
      method: this.#request.method,
      path,
      ip: headers['x-forwarded-for'] || headers['x-real-ip'] || '',
      headers,
      responseHeaders,
      userAgent: this.#request.headers.get('user-agent') ?? '',
      status: worstStatus,
      procedures: this.#procedures,
      isBatch: this.#procedures.length > 1,
    })
  }

  /** Whether any procedures have been recorded. */
  get hasProcedures(): boolean {
    return this.#procedures.length > 0
  }
}

// ── Cookie Parser (fast, zero-alloc for single key) ─

function parseCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  const prefix = name + '='
  let start = header.indexOf(prefix)
  if (start === -1) return undefined
  // Ensure it's a full match (not "other_sid=")
  if (start > 0 && header[start - 1] !== ' ' && header[start - 1] !== ';') {
    start = header.indexOf('; ' + prefix)
    if (start === -1) return undefined
    start += 2 // skip "; "
  }
  const valueStart = start + prefix.length
  const valueEnd = header.indexOf(';', valueStart)
  return valueEnd === -1 ? header.slice(valueStart) : header.slice(valueStart, valueEnd)
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
    for (let i = 0; i < e.spans.length; i++) {
      const s = e.spans[i]!
      const errMark = s.error ? ` ❌ ${s.error}` : ''
      md += `**${i + 1}. [${s.kind}] ${s.name}** — ${s.durationMs}ms${errMark}\n`
      if (s.detail) md += `\`\`\`\n${s.detail}\n\`\`\`\n`
    }
    md += '\n'
  }

  md += `### Error Message\n\n\`\`\`\n${e.error}\n\`\`\``
  return md
}

export function requestToMarkdown(r: RequestEntry): string {
  const time = new Date(r.timestamp).toISOString()
  const emoji = r.status >= 500 ? '💥' : r.status >= 400 ? '⚠️' : '✅'

  let md = `## ${emoji} ${r.method} ${r.path} → ${r.status} (${r.durationMs}ms)\n\n`
  md += `| Field | Value |\n|-------|-------|\n`
  md += `| Request ID | \`${r.requestId}\` |\n`
  md += `| Session ID | \`${r.sessionId}\` |\n`
  md += `| Method | ${r.method} |\n`
  md += `| Path | \`${r.path}\` |\n`
  md += `| Status | ${r.status} |\n`
  md += `| Duration | ${r.durationMs}ms |\n`
  md += `| Time | ${time} |\n`
  md += `| IP | ${r.ip} |\n`
  md += `| Procedures | ${r.procedures.length} |\n`
  if (r.isBatch) md += `| Batch | Yes |\n`
  md += '\n'

  for (let i = 0; i < r.procedures.length; i++) {
    const p = r.procedures[i]!
    const pEmoji = p.status >= 400 ? '⚠️' : '✅'
    md += `### ${pEmoji} ${i + 1}. \`${p.procedure}\` → ${p.status} (${p.durationMs}ms)\n\n`

    if (p.input !== undefined && p.input !== null) {
      md += `#### Input\n\n\`\`\`json\n${safeStringify(p.input)}\n\`\`\`\n\n`
    }

    if (p.spans.length > 0) {
      // Timing by kind
      const byKind = new Map<string, number>()
      for (const s of p.spans) byKind.set(s.kind, (byKind.get(s.kind) ?? 0) + s.durationMs)
      const tracedMs = [...byKind.values()].reduce((a, b) => a + b, 0)
      const appMs = Math.max(0, p.durationMs - tracedMs)
      const total = Math.max(p.durationMs, 0.1)

      md += `#### Timing\n\n| Category | Duration | % |\n|----------|----------|---|\n`
      md += `| **Total** | **${p.durationMs}ms** | 100% |\n`
      for (const [kind, ms] of byKind) md += `| ${kind} | ${round(ms)}ms | ${round((ms / total) * 100)}% |\n`
      md += `| App Logic | ${round(appMs)}ms | ${round((appMs / total) * 100)}% |\n\n`

      for (let j = 0; j < p.spans.length; j++) {
        const s = p.spans[j]!
        const offset = s.startOffsetMs != null ? ` (at +${s.startOffsetMs}ms)` : ''
        const err = s.error ? ` ❌ ${s.error}` : ''
        md += `**${j + 1}. [${s.kind}] ${s.name}** — ${s.durationMs}ms${offset}${err}\n`
        if (s.detail) md += `\`\`\`\n${s.detail}\n\`\`\`\n`
      }
      md += '\n'
    }

    if (p.error) md += `#### Error\n\n\`\`\`\n${p.error}\n\`\`\`\n\n`
  }

  md += `---\n\n**Analyze this request and suggest performance optimizations:**\n`
  md += `- Redundant or slow operations that could be combined?\n`
  md += `- N+1 query pattern?\n`
  md += `- Data that should be cached?\n`
  md += `- Sequential calls that could run in parallel?\n`
  if (r.durationMs > 100) md += `- ⚠️ This request took ${r.durationMs}ms — what is the bottleneck?\n`

  return md
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}

// ── Dashboard HTML ──────────────────────────────────

const __analytics_dirname = dirname(fileURLToPath(import.meta.url))

let _dashboardCache: string | undefined

export function analyticsHTML(): string {
  if (_dashboardCache) return _dashboardCache

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
