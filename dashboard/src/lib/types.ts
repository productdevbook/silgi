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

export interface RequestEntry {
  id: number
  timestamp: number
  procedure: string
  durationMs: number
  status: number
  input: unknown
  spans: TraceSpan[]
}
