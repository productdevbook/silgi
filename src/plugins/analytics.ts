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

import { parse as parseCookieHeader } from 'cookie-es'

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
  /** Structured key-value attributes (db.name, auth.operation, user.id, etc.) */
  attributes?: Record<string, string | number | boolean>
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
  /** Interval in ms between storage flushes (default: 5000) */
  flushInterval?: number
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
    _counter = (_counter + 1) & 0xfff // 12 bits = 4096 per ms
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
  const low = ((now & 0x3ff) << 22) | (_counter << 10) | ((Math.random() * 1024) >>> 0)

  return high.toString(36) + low.toString(36).padStart(7, '0')
}

// ── Request Trace (per-request span collector) ──────

export class RequestTrace {
  spans: TraceSpan[] = []
  /** Procedure-level input — set via `setProcedureInput()` or `trace(..., { procedure: { input } })` */
  procedureInput: unknown = undefined
  /** Procedure-level output — set via `setProcedureOutput()` or `trace(..., { procedure: { output } })` */
  procedureOutput: unknown = undefined
  /** @internal Start time — used by integrations (drizzle etc.) for span offset calculation */
  readonly t0 = performance.now()

  async trace<T>(
    name: string,
    fn: () => T | Promise<T>,
    opts?: {
      kind?: SpanKind
      detail?: string
      input?: unknown
      output?: unknown | ((result: T) => unknown)
      procedure?: { input?: unknown; output?: unknown | ((result: T) => unknown) }
    },
  ): Promise<T> {
    const start = performance.now()
    const kind = opts?.kind ?? guessKind(name)
    try {
      const result = await fn()
      this.spans.push({
        name,
        kind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - this.t0),
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
        startOffsetMs: round(start - this.t0),
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
  if (
    lower.startsWith('db.') ||
    lower.includes('sql') ||
    lower.includes('prisma') ||
    lower.includes('drizzle') ||
    lower.includes('query') ||
    lower.includes('mongo')
  )
    return 'db'
  if (lower.startsWith('http.') || lower.includes('fetch') || lower.includes('api.')) return 'http'
  if (lower.startsWith('cache.') || lower.includes('redis') || lower.includes('memcache')) return 'cache'
  if (lower.includes('queue') || lower.includes('publish') || lower.includes('nats') || lower.includes('kafka'))
    return 'queue'
  if (lower.includes('email') || lower.includes('smtp') || lower.includes('ses')) return 'email'
  if (lower.includes('ai') || lower.includes('llm') || lower.includes('openai') || lower.includes('gemini')) return 'ai'
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
export async function trace<T>(
  ctx: Record<string, unknown>,
  name: string,
  fn: () => T | Promise<T>,
  opts?: {
    kind?: SpanKind
    detail?: string
    input?: unknown
    output?: unknown | ((result: T) => unknown)
    procedure?: { input?: unknown; output?: unknown | ((result: T) => unknown) }
  },
): Promise<T> {
  const reqTrace = ctx.__analyticsTrace as RequestTrace | undefined
  if (reqTrace) {
    return reqTrace.trace(name, fn, opts)
  }
  return fn()
}

// ── Persistent Store ─────────────────────────────────

import { useStorage } from '../core/storage.ts'

class AnalyticsStore {
  #storage: ReturnType<typeof useStorage>
  #pendingRequests: RequestEntry[] = []
  #pendingErrors: ErrorEntry[] = []
  #maxRequests: number
  #maxErrors: number
  #timer: ReturnType<typeof setInterval> | null = null
  #flushing = false

  constructor(maxRequests: number, maxErrors: number, flushInterval: number) {
    this.#storage = useStorage('data')
    this.#maxRequests = maxRequests
    this.#maxErrors = maxErrors
    this.#timer = setInterval(() => this.flush(), flushInterval)
    if (typeof this.#timer === 'object' && 'unref' in this.#timer) this.#timer.unref()
  }

  enqueueRequest(entry: RequestEntry): void {
    this.#pendingRequests.push(entry)
  }

  enqueueError(entry: ErrorEntry): void {
    this.#pendingErrors.push(entry)
  }

  async flush(): Promise<void> {
    if (this.#flushing) return
    const requests = this.#pendingRequests.splice(0)
    const errors = this.#pendingErrors.splice(0)
    if (requests.length === 0 && errors.length === 0) return

    this.#flushing = true
    try {
      if (requests.length > 0) {
        const existing = (await this.#storage.getItem<RequestEntry[]>('analytics:requests')) ?? []
        const merged = [...existing, ...requests].slice(-this.#maxRequests)
        await this.#storage.setItem('analytics:requests', merged)
      }
      if (errors.length > 0) {
        const existing = (await this.#storage.getItem<ErrorEntry[]>('analytics:errors')) ?? []
        const merged = [...existing, ...errors].slice(-this.#maxErrors)
        await this.#storage.setItem('analytics:errors', merged)
      }
    } catch {
      // Storage failure — re-enqueue items so they're not lost
      this.#pendingRequests.unshift(...requests)
      this.#pendingErrors.unshift(...errors)
    } finally {
      this.#flushing = false
    }
  }

  async getRequests(): Promise<RequestEntry[]> {
    const stored = (await this.#storage.getItem<RequestEntry[]>('analytics:requests')) ?? []
    if (this.#pendingRequests.length === 0) return stored
    return [...stored, ...this.#pendingRequests].slice(-this.#maxRequests)
  }

  async getErrors(): Promise<ErrorEntry[]> {
    const stored = (await this.#storage.getItem<ErrorEntry[]>('analytics:errors')) ?? []
    if (this.#pendingErrors.length === 0) return stored
    return [...stored, ...this.#pendingErrors].slice(-this.#maxErrors)
  }

  async hydrate(): Promise<{ totalRequests: number; totalErrors: number }> {
    try {
      const counters = await this.#storage.getItem<{ totalRequests: number; totalErrors: number }>('analytics:counters')
      return counters ?? { totalRequests: 0, totalErrors: 0 }
    } catch {
      return { totalRequests: 0, totalErrors: 0 }
    }
  }

  async saveCounters(totalRequests: number, totalErrors: number): Promise<void> {
    try {
      await this.#storage.setItem('analytics:counters', { totalRequests, totalErrors })
    } catch {
      // Best-effort
    }
  }

  async dispose(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer)
    this.#timer = null
    await this.flush()
  }
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
  #store: AnalyticsStore
  #counterFlushCounter = 0

  constructor(options: AnalyticsOptions = {}) {
    this.#bufferSize = options.bufferSize ?? 1024
    this.#historySeconds = options.historySeconds ?? 120
    this.#maxErrors = options.maxErrors ?? 100
    this.#maxRequests = options.maxRequests ?? 200
    this.#currentWindow = { time: Math.floor(Date.now() / 1000), count: 0, errors: 0 }

    this.#store = new AnalyticsStore(this.#maxRequests, this.#maxErrors, options.flushInterval ?? 5000)
    this.#store.hydrate().then((c) => {
      this.#totalRequests += c.totalRequests
      this.#totalErrors += c.totalErrors
    })
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
    const full = { ...entry, id: this.#nextErrorId++ }
    this.#errors.push(full)
    if (this.#errors.length > this.#maxErrors) {
      this.#errors.shift()
    }
    this.#store.enqueueError(full)
  }

  recordDetailedRequest(entry: Omit<RequestEntry, 'id'>): void {
    const full = { ...entry, id: this.#nextRequestId++ }
    this.#requests.push(full)
    if (this.#requests.length > this.#maxRequests) {
      this.#requests.shift()
    }
    this.#store.enqueueRequest(full)
    this.#flushCountersIfNeeded()
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

  getErrors(): Promise<ErrorEntry[]> {
    return this.#store.getErrors()
  }

  getRequests(): Promise<RequestEntry[]> {
    return this.#store.getRequests()
  }

  #flushCountersIfNeeded(): void {
    if (++this.#counterFlushCounter % 50 === 0) {
      this.#store.saveCounters(this.#totalRequests, this.#totalErrors)
    }
  }

  async dispose(): Promise<void> {
    await this.#store.saveCounters(this.#totalRequests, this.#totalErrors)
    await this.#store.dispose()
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
  t0: number
  #request: Request
  #procedures: ProcedureCall[] = []
  #collector: AnalyticsCollector

  constructor(request: Request, collector: AnalyticsCollector) {
    this.requestId = generateRequestId()
    this.t0 = performance.now()
    this.#request = request
    this.#collector = collector

    // Read or generate session ID from cookie
    const cookieHeader = request.headers.get('cookie')
    const existing = cookieHeader ? parseCookieHeader(cookieHeader)[SESSION_COOKIE] : undefined
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

    const durationMs = round(performance.now() - this.t0)
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

// ── Analytics HTTP routing (used by handler.ts) ─────

export function checkAnalyticsAuth(
  request: Request,
  auth: string | ((req: Request) => boolean | Promise<boolean>),
): boolean | Promise<boolean> {
  if (typeof auth === 'function') return auth(request)
  const cookie = request.headers.get('cookie')
  if (cookie) {
    const cookies = parseCookieHeader(cookie)
    if (cookies['silgi-auth'] === auth) return true
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${auth}`) return true
  return false
}

export function sanitizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  const sensitiveKeys = new Set(['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'])
  headers.forEach((value, key) => {
    result[key] = sensitiveKeys.has(key.toLowerCase()) ? '[REDACTED]' : value
  })
  return result
}

const analyticsLoginHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Silgi Analytics</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5}
.c{width:100%;max-width:360px;padding:0 24px}
.logo{display:flex;align-items:center;gap:8px;margin-bottom:20px}
.logo svg{width:20px;height:20px;color:#c2822a}
.logo span{font-size:14px;font-weight:600;letter-spacing:-.01em}
p{font-size:13px;color:#737373;margin-bottom:16px;line-height:1.5}
input{width:100%;height:40px;padding:0 12px;background:#171717;border:1px solid #262626;border-radius:6px;color:#e5e5e5;font-size:13px;outline:none}
input:focus{border-color:#c2822a}
input::placeholder{color:#525252}
button{width:100%;height:36px;margin-top:10px;background:#c2822a;color:#0a0a0a;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer}
button:hover{background:#d4943b}
.err{color:#ef4444;font-size:12px;margin-top:8px;display:none}
</style>
</head>
<body>
<div class="c">
<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg><span>Silgi Analytics</span></div>
<p>Enter your access token to view the dashboard.</p>
<form id="f"><input id="t" type="password" placeholder="Access token" autofocus><div class="err" id="e">Invalid token</div><button type="submit">Authenticate</button></form>
</div>
<script>
document.getElementById('f').onsubmit=function(e){
e.preventDefault();
var t=document.getElementById('t').value.trim();
if(!t)return;
document.cookie='silgi-auth='+encodeURIComponent(t)+';path=/analytics;samesite=strict';
fetch('/analytics/_api/stats',{headers:{'cookie':'silgi-auth='+encodeURIComponent(t)}}).then(function(){
location.reload();
}).catch(function(){location.reload()});
};
</script>
</body>
</html>`

/** Return auth-failure response for analytics routes. */
export function analyticsAuthResponse(pathname: string): Response {
  const jsonHeaders = { 'content-type': 'application/json' }
  if (pathname.includes('_api/')) {
    return new Response(JSON.stringify({ code: 'UNAUTHORIZED', status: 401, message: 'Invalid token' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  return new Response(analyticsLoginHTML, { status: 401, headers: { 'content-type': 'text/html' } })
}

/** Serve analytics dashboard and API routes. */
export async function serveAnalyticsRoute(
  pathname: string,
  collector: AnalyticsCollector,
  dashboardHtml: string | undefined,
): Promise<Response> {
  const jsonCacheHeaders = { 'content-type': 'application/json', 'cache-control': 'no-cache' }
  const mdHeaders = { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' }

  if (pathname === 'analytics/_api/stats') {
    return new Response(JSON.stringify(collector.toJSON()), { headers: jsonCacheHeaders })
  }
  if (pathname === 'analytics/_api/errors') {
    const errors = await collector.getErrors()
    return new Response(JSON.stringify(errors), { headers: jsonCacheHeaders })
  }
  if (pathname === 'analytics/_api/requests') {
    const requests = await collector.getRequests()
    return new Response(JSON.stringify(requests), { headers: jsonCacheHeaders })
  }
  if (pathname.startsWith('analytics/_api/requests/') && pathname.endsWith('/md')) {
    const id = Number(pathname.slice('analytics/_api/requests/'.length, -'/md'.length))
    const requests = await collector.getRequests()
    const entry = requests.find((r) => r.id === id)
    if (entry) return new Response(requestToMarkdown(entry), { headers: mdHeaders })
    return new Response('not found', { status: 404 })
  }
  if (pathname.startsWith('analytics/_api/errors/') && pathname.endsWith('/md')) {
    const id = Number(pathname.slice('analytics/_api/errors/'.length, -'/md'.length))
    const errors = await collector.getErrors()
    const entry = errors.find((e) => e.id === id)
    if (entry) return new Response(errorToMarkdown(entry), { headers: mdHeaders })
    return new Response('not found', { status: 404 })
  }
  if (pathname === 'analytics/_api/errors/md') {
    const errors = await collector.getErrors()
    const md =
      errors.length === 0
        ? 'No errors.\n'
        : `# Errors (${errors.length})\n\n` + errors.map((e) => errorToMarkdown(e)).join('\n\n---\n\n')
    return new Response(md, { headers: mdHeaders })
  }
  return new Response(dashboardHtml, { headers: { 'content-type': 'text/html' } })
}

// ── Handler Wrapper ─────────────────────────────────

import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { FetchHandler } from '../core/handler.ts'

/**
 * Wrap a fetch handler with analytics collection.
 * Intercepts analytics dashboard routes and instruments every request.
 */
export function wrapWithAnalytics(handler: FetchHandler, options: AnalyticsOptions = {}): FetchHandler {
  const collector = new AnalyticsCollector(options)
  const dashboardHtml = analyticsHTML()
  const auth = options.auth

  return async (request: Request): Promise<Response> => {
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    // Analytics dashboard routes
    if (pathname.startsWith('analytics')) {
      if (auth) {
        const authResult = checkAnalyticsAuth(request, auth)
        const ok = authResult instanceof Promise ? await authResult : authResult
        if (!ok) return analyticsAuthResponse(pathname)
      }
      return serveAnalyticsRoute(pathname, collector, dashboardHtml)
    }

    // Instrument the request
    const acc = new RequestAccumulator(request, collector)
    const reqTrace = new RequestTrace()
    const t0 = performance.now()

    // Inject trace into request headers so context factory can access it
    // We use a WeakMap to avoid mutating the request
    analyticsTraceMap.set(request, reqTrace)

    let response: Response
    try {
      response = await handler(request)
      const durationMs = round(performance.now() - t0)

      collector.record(pathname, durationMs)
      acc.addProcedure({
        procedure: pathname,
        durationMs,
        status: response.status,
        input: null,
        output: null,
        spans: reqTrace.spans ?? [],
      })
    } catch (error) {
      const durationMs = round(performance.now() - t0)
      const errorMsg = error instanceof Error ? error.message : String(error)
      const isValidation = error instanceof ValidationError
      const silgiErr = isValidation ? null : error instanceof SilgiError ? error : toSilgiError(error)
      const errStatus = isValidation ? 400 : (silgiErr?.status ?? 500)

      collector.recordError(pathname, durationMs, errorMsg)
      collector.recordDetailedError({
        requestId: acc.requestId,
        timestamp: Date.now(),
        procedure: pathname,
        error: errorMsg,
        code: isValidation ? 'BAD_REQUEST' : (silgiErr?.code ?? 'INTERNAL_SERVER_ERROR'),
        status: errStatus,
        stack: error instanceof Error ? (error.stack ?? '').slice(0, 2048) : '',
        input: null,
        headers: sanitizeHeaders(request.headers),
        durationMs,
        spans: reqTrace.spans ?? [],
      })
      throw error
    } finally {
      analyticsTraceMap.delete(request)
    }

    // Inject analytics headers
    const headers = new Headers(response.headers)
    headers.set('x-request-id', acc.requestId)
    const cookie = acc.getSessionCookie()
    if (cookie) headers.append('set-cookie', cookie)
    const injected = new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    acc.flushWithResponse(injected)
    return injected
  }
}

/** WeakMap to pass analytics trace to context without coupling handler to analytics. */
export const analyticsTraceMap = new WeakMap<Request, RequestTrace>()
