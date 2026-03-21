import type { ErrorEntry, RequestEntry } from './types'

export const SLOW_REQUEST_MS = 10

export type RequestStatusFilter = 'all' | 'success' | 'client' | 'server'
export type RequestLatencyFilter = 'all' | 'fast' | 'slow'
export type ErrorSeverityFilter = 'all' | 'client' | 'server'
export type ErrorTraceFilter = 'all' | 'traced' | 'untraced'

export interface RequestListFilters {
  query: string
  procedure: string
  status: RequestStatusFilter
  latency: RequestLatencyFilter
}

export interface ErrorListFilters {
  query: string
  procedure: string
  severity: ErrorSeverityFilter
  trace: ErrorTraceFilter
}

export interface RequestListSummary {
  averageDuration: number
  errorCount: number
  maxSpans: number
  uniqueProcedures: number
}

export interface ErrorListSummary {
  uniqueCodes: number
  longestDuration: number
  tracedCount: number
  uniqueProcedures: number
}

export function filterRequests(requests: RequestEntry[], filters: RequestListFilters) {
  const query = filters.query.trim().toLowerCase()

  return requests.filter((entry) => {
    if (query && !entry.procedure.toLowerCase().includes(query)) return false

    if (filters.procedure !== 'all' && entry.procedure !== filters.procedure) return false

    if (filters.status === 'success' && entry.status >= 400) return false

    if (filters.status === 'client' && (entry.status < 400 || entry.status >= 500)) return false

    if (filters.status === 'server' && entry.status < 500) return false

    if (filters.latency === 'fast' && entry.durationMs >= SLOW_REQUEST_MS) return false

    if (filters.latency === 'slow' && entry.durationMs < SLOW_REQUEST_MS) return false

    return true
  })
}

export function summarizeRequests(requests: RequestEntry[]): RequestListSummary {
  const averageDuration =
    requests.length > 0 ? requests.reduce((sum, entry) => sum + entry.durationMs, 0) / requests.length : 0

  return {
    averageDuration,
    errorCount: requests.filter((entry) => entry.status >= 400).length,
    maxSpans: requests.reduce((max, entry) => Math.max(max, entry.spans.length), 0),
    uniqueProcedures: getProcedureOptions(requests.map((entry) => entry.procedure)).length,
  }
}

export function filterErrors(errors: ErrorEntry[], filters: ErrorListFilters) {
  const query = filters.query.trim().toLowerCase()

  return errors.filter((entry) => {
    if (
      query &&
      !entry.procedure.toLowerCase().includes(query) &&
      !entry.code.toLowerCase().includes(query) &&
      !entry.error.toLowerCase().includes(query)
    )
      return false

    if (filters.procedure !== 'all' && entry.procedure !== filters.procedure) return false

    if (filters.severity === 'client' && (entry.status < 400 || entry.status >= 500)) return false

    if (filters.severity === 'server' && entry.status < 500) return false

    if (filters.trace === 'traced' && entry.spans.length === 0) return false

    if (filters.trace === 'untraced' && entry.spans.length > 0) return false

    return true
  })
}

export function summarizeErrors(errors: ErrorEntry[]): ErrorListSummary {
  return {
    uniqueCodes: new Set(errors.map((entry) => entry.code)).size,
    longestDuration: errors.reduce((max, entry) => Math.max(max, entry.durationMs), 0),
    tracedCount: errors.filter((entry) => entry.spans.length > 0).length,
    uniqueProcedures: getProcedureOptions(errors.map((entry) => entry.procedure)).length,
  }
}

export function getProcedureOptions(procedures: string[]) {
  return [...new Set(procedures)].toSorted((a, b) => a.localeCompare(b))
}
