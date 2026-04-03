/**
 * AnalyticsCollector — in-memory metrics aggregation.
 *
 * Tracks per-procedure counts, latencies, errors, tasks.
 * Backed by AnalyticsStore for persistence.
 */

import { AlertEngine } from './alerts.ts'
import { CostTracker } from './cost.ts'
import { AnalyticsSSEHub } from './sse.ts'
import { AnalyticsStore } from './store.ts'
import { TimeSeriesAggregator } from './timeseries.ts'
import { RingBuffer as RingBufferClass } from './types.ts'
import { matchesPathPrefix, round } from './utils.ts'

import type {
  AnalyticsOptions,
  AnalyticsSnapshot,
  ErrorEntry,
  ProcedureEntry,
  ProcedureSnapshot,
  RequestEntry,
  RingBuffer,
  TaskExecution,
  TaskSnapshot,
  TimeWindow,
  TraceSpan,
} from './types.ts'

/** Internal in-memory buffer caps — not user-configurable */
const MEM_MAX_REQUESTS = 10_000
const MEM_MAX_ERRORS = 10_000
const MEM_MAX_TASKS = 10_000

export class AnalyticsCollector {
  #procedures = new Map<string, ProcedureEntry>()
  #startTime = Date.now()
  #totalRequests = 0
  #totalErrors = 0
  #bufferSize: number
  #historySeconds: number
  #timeSeries: TimeWindow[] = []
  #currentWindow: TimeWindow
  #errors: ErrorEntry[] = []
  #nextErrorId = 1
  #requests: RequestEntry[] = []
  #nextRequestId = 1
  #taskExecutions: TaskExecution[] = []
  #nextTaskId = 1
  #taskStats = new Map<string, { runs: number; errors: number; totalDuration: number; lastRun: number }>()
  #store: AnalyticsStore
  #counterFlushCounter = 0
  /** Server-side ignore — from config, prevents recording entirely */
  #ignorePaths: Set<string>
  /** Client-side hide — from dashboard, filters display only */
  #hiddenPaths: Set<string> = new Set()
  /** SSE hub for real-time streaming */
  sseHub: AnalyticsSSEHub
  /** Multi-tier time-series aggregation */
  timeseries: TimeSeriesAggregator
  /** Alert engine */
  alertEngine: AlertEngine | null = null
  /** Cost tracker */
  costTracker: CostTracker

  constructor(options: AnalyticsOptions = {}) {
    this.#bufferSize = options.bufferSize ?? 1024
    this.#historySeconds = options.historySeconds ?? 120
    this.#ignorePaths = new Set((options.ignorePaths ?? []).map((p) => (p.startsWith('/') ? p.slice(1) : p)))
    this.#currentWindow = { time: Math.floor(Date.now() / 1000), count: 0, errors: 0 }

    this.sseHub = new AnalyticsSSEHub()
    this.sseHub.startStatsBroadcast(() => this.toJSON())
    this.timeseries = new TimeSeriesAggregator()
    this.costTracker = new CostTracker(options.budgets, (rule, current) => {
      if (this.alertEngine) {
        console.warn(`[silgi:budget] "${rule.name}" exceeded: $${current.toFixed(2)} / $${rule.limit}`)
      }
    })

    if (options.alerts && options.alerts.length > 0) {
      this.alertEngine = new AlertEngine(options.alerts)
    }

    this.#store = new AnalyticsStore(options.flushInterval ?? 5000, options.retentionDays ?? 30)
    this.#store.hydrate().then((c) => {
      this.#totalRequests += c.totalRequests
      this.#totalErrors += c.totalErrors
    })
    this.#store.loadHiddenPaths().then((paths) => {
      for (const p of paths) this.#hiddenPaths.add(p)
    })
  }

  /** Check if a path is server-side ignored (from config). */
  isIgnored(pathname: string): boolean {
    if (this.#ignorePaths.size === 0) return false
    return matchesPathPrefix(pathname, this.#ignorePaths)
  }

  /** Check if a path is hidden in the dashboard (from runtime API). */
  isHidden(pathname: string): boolean {
    if (this.#hiddenPaths.size === 0) return false
    return matchesPathPrefix(pathname, this.#hiddenPaths)
  }

  addHiddenPath(path: string): void {
    const normalized = path.startsWith('/') ? path.slice(1) : path
    this.#hiddenPaths.add(normalized)
    this.#store.saveHiddenPaths([...this.#hiddenPaths])
  }

  removeHiddenPath(path: string): void {
    const normalized = path.startsWith('/') ? path.slice(1) : path
    this.#hiddenPaths.delete(normalized)
    this.#store.saveHiddenPaths([...this.#hiddenPaths])
  }

  getHiddenPaths(): string[] {
    return [...this.#hiddenPaths]
  }

  record(path: string, durationMs: number): void {
    this.#totalRequests++
    const entry = this.#getOrCreate(path)
    entry.count++
    entry.latencies.push(durationMs)
    this.#tick(false)
    this.timeseries.record(durationMs, false)
    this.alertEngine?.record(durationMs, false, path)
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
    this.timeseries.record(durationMs, true)
    this.alertEngine?.record(durationMs, true, path)
  }

  recordDetailedError(entry: Omit<ErrorEntry, 'id'>): void {
    const full = { ...entry, id: this.#nextErrorId++ }
    this.#errors.push(full)
    if (this.#errors.length > MEM_MAX_ERRORS) {
      this.#errors.shift()
    }
    this.#store.enqueueError(full)
    this.sseHub.broadcast({ type: 'error', data: full })
  }

  recordDetailedRequest(entry: Omit<RequestEntry, 'id'>): void {
    const full = { ...entry, id: this.#nextRequestId++ }
    this.#requests.push(full)
    if (this.#requests.length > MEM_MAX_REQUESTS) {
      this.#requests.shift()
    }
    this.#store.enqueueRequest(full)
    this.sseHub.broadcast({ type: 'request', data: full })
    this.#flushCountersIfNeeded()
  }

  recordTask(entry: Omit<TaskExecution, 'id'>): void {
    const full = { ...entry, id: this.#nextTaskId++ }
    this.#taskExecutions.push(full)
    if (this.#taskExecutions.length > MEM_MAX_TASKS) {
      this.#taskExecutions.shift()
    }
    this.sseHub.broadcast({ type: 'task', data: full })

    // Aggregate stats
    let stats = this.#taskStats.get(entry.taskName)
    if (!stats) {
      stats = { runs: 0, errors: 0, totalDuration: 0, lastRun: 0 }
      this.#taskStats.set(entry.taskName, stats)
    }
    stats.runs++
    if (entry.status === 'error') stats.errors++
    stats.totalDuration += entry.durationMs
    stats.lastRun = entry.timestamp
  }

  async getTaskExecutions(): Promise<TaskExecution[]> {
    return [...this.#taskExecutions]
  }

  #getOrCreate(path: string): ProcedureEntry {
    let entry = this.#procedures.get(path)
    if (!entry) {
      entry = {
        count: 0,
        errors: 0,
        latencies: new RingBufferClass(this.#bufferSize),
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
      tasks: this.#taskSnapshotJSON(),
    }
  }

  #taskSnapshotJSON(): TaskSnapshot {
    let totalRuns = 0
    let totalErrors = 0
    const tasks: TaskSnapshot['tasks'] = {}
    for (const [name, s] of this.#taskStats) {
      totalRuns += s.runs
      totalErrors += s.errors
      tasks[name] = {
        runs: s.runs,
        errors: s.errors,
        avgDurationMs: s.runs > 0 ? round(s.totalDuration / s.runs) : 0,
        lastRun: s.lastRun || null,
      }
    }
    return { totalRuns, totalErrors, tasks }
  }
}
