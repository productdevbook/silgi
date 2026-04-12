import type { ErrorEntry, RequestEntry } from './types'

export const SLOW_REQUEST_MS = 100

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

/** Get all procedure names from a request. */
function requestProcedures(entry: RequestEntry): string {
  return entry.procedures.map((p) => p.procedure).join(', ')
}

export function filterRequests(requests: RequestEntry[], filters: RequestListFilters) {
  const query = filters.query.trim().toLowerCase()

  return requests.filter((entry) => {
    const procs = requestProcedures(entry)
    if (query && !procs.toLowerCase().includes(query) && !entry.path.toLowerCase().includes(query)) return false

    if (filters.procedure !== 'all' && !entry.procedures.some((p) => p.procedure === filters.procedure)) return false

    if (filters.status === 'success' && entry.status >= 400) return false

    if (filters.status === 'client' && (entry.status < 400 || entry.status >= 500)) return false

    if (filters.status === 'server' && entry.status < 500) return false

    if (filters.latency === 'fast' && entry.durationMs >= SLOW_REQUEST_MS) return false

    if (filters.latency === 'slow' && entry.durationMs < SLOW_REQUEST_MS) return false

    return true
  })
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

export function getProcedureOptions(procedures: string[]) {
  return [...new Set(procedures)].toSorted((a, b) => a.localeCompare(b))
}
