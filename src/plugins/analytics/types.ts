/**
 * Analytics type definitions and RingBuffer data structure.
 */

// ── Ring Buffer (fixed memory, no GC pressure) ──────

export class RingBuffer {
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

export interface ProcedureEntry {
  count: number
  errors: number
  latencies: RingBuffer
  lastError: string | null
  lastErrorTime: number
}

export interface TimeWindow {
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
  /** Cost metadata for this span (tokens, price, provider). */
  cost?: import('./cost.ts').SpanCost
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
  url: string
  path: string
  ip: string
  headers: Record<string, string>
  responseHeaders: Record<string, string>
  userAgent: string
  status: number
  procedures: ProcedureCall[]
  isBatch: boolean
  /** Trace ID for correlating related requests across services. */
  traceId?: string
  /** Parent request ID — links child requests to the originating request. */
  parentRequestId?: string
}

/** A background task execution record. */
export interface TaskExecution {
  id: number
  taskName: string
  trigger: 'dispatch' | 'cron' | 'http'
  timestamp: number
  durationMs: number
  status: 'success' | 'error'
  error?: string
  input?: unknown
  output?: unknown
  spans: TraceSpan[]
}

export interface AnalyticsOptions {
  /** Latency samples to keep per procedure (default: 1024) */
  bufferSize?: number
  /** Time-series history in seconds (default: 120) */
  historySeconds?: number
  /**
   * Protect dashboard access.
   * - `string` — secret token checked against `Authorization: Bearer <token>` header or `?token=` query param
   * - `(req: Request) => boolean | Promise<boolean>` — custom auth function
   * - `undefined` — no auth (open access, NOT recommended in production)
   */
  auth?: string | ((req: Request) => boolean | Promise<boolean>)
  /** Interval in ms between storage flushes (default: 5000) */
  flushInterval?: number
  /** Days to retain entries in storage (default: 30). Entries older than this are pruned on flush. */
  retentionDays?: number
  /** Path prefixes to exclude from tracking. Can also be managed at runtime via the dashboard or API. */
  ignorePaths?: string[]
  /** Alert rules — fire actions when conditions are met within a sliding window. */
  alerts?: import('./alerts.ts').AlertRule[]
  /** Budget rules for cost tracking. */
  budgets?: import('./cost.ts').BudgetRule[]
}

export interface ProcedureSnapshot {
  count: number
  errors: number
  errorRate: number
  latency: { avg: number; p50: number; p95: number; p99: number }
  lastError: string | null
  lastErrorTime: number | null
  inputSchema?: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export interface TaskSnapshot {
  totalRuns: number
  totalErrors: number
  tasks: Record<string, { runs: number; errors: number; avgDurationMs: number; lastRun: number | null }>
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
  tasks: TaskSnapshot
}
