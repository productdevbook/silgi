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
  tasks?: TaskSnapshot
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
  attributes?: Record<string, string | number | boolean>
}

export interface ErrorEntry {
  id: number
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

/** A background task execution. */
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

export interface TaskSnapshot {
  totalRuns: number
  totalErrors: number
  tasks: Record<string, { runs: number; errors: number; avgDurationMs: number; lastRun: number | null }>
}

export interface ScheduledTaskInfo {
  name: string
  cron: string
  description?: string
  nextRun: number | null
  lastRun: number | null
  runs: number
  errors: number
}

/** An HTTP request containing one or more procedure calls. */
export interface RequestEntry {
  id: number
  requestId: string
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
}
