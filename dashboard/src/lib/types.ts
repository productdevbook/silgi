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

export type SpanKind = 'db' | 'http' | 'cache' | 'queue' | 'email' | 'ai' | 'custom'

export interface TraceSpan {
  name: string
  kind: SpanKind
  durationMs: number
  startOffsetMs?: number
  detail?: string
  error?: string
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

export interface AnalyticsUser {
  id?: string | number
  name?: string
  email?: string
  [key: string]: unknown
}

/** An HTTP request containing one or more procedure calls. */
export interface RequestEntry {
  id: number
  requestId: string
  sessionId: string
  user?: AnalyticsUser
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
