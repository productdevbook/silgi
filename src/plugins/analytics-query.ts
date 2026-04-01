/**
 * Analytics Query Engine — server-side filtering, sorting, and cursor-based pagination.
 */

import type { ErrorEntry, RequestEntry, TaskExecution } from './analytics.ts'

// ── Query Types ──

export interface QueryParams {
  /** Cursor: entries after this ID (for forward pagination) */
  cursor?: number
  /** Cursor: entries before this ID (for backward pagination) */
  before?: number
  /** Max items to return (default: 50) */
  limit?: number
  /** Sort field */
  sort?: string
  /** Sort direction */
  order?: 'asc' | 'desc'
  /** Status filter: exact code (200), class (2xx/4xx/5xx), or range (>=400) */
  status?: string
  /** Path prefix filter */
  path?: string
  /** Full-text search across procedure names, errors, paths */
  search?: string
  /** Procedure name filter */
  procedure?: string
  /** Session ID filter */
  session?: string
  /** Minimum duration in ms */
  minDuration?: number
  /** Maximum duration in ms */
  maxDuration?: number
}

export interface PaginatedResult<T> {
  data: T[]
  total: number
  hasMore: boolean
  nextCursor: number | null
  prevCursor: number | null
}

// ── Parse Query Params ──

export function parseQueryParams(params: URLSearchParams): QueryParams {
  const q: QueryParams = {}
  const cursor = params.get('cursor')
  if (cursor) q.cursor = Number(cursor)
  const before = params.get('before')
  if (before) q.before = Number(before)
  const limit = params.get('limit')
  q.limit = limit ? Math.max(1, Number(limit)) : 50
  q.sort = params.get('sort') ?? undefined
  q.order = (params.get('order') as 'asc' | 'desc') ?? undefined
  q.status = params.get('status') ?? undefined
  q.path = params.get('path') ?? undefined
  q.search = params.get('search') ?? undefined
  q.procedure = params.get('procedure') ?? undefined
  q.session = params.get('session') ?? undefined
  const minDuration = params.get('minDuration')
  if (minDuration) q.minDuration = Number(minDuration)
  const maxDuration = params.get('maxDuration')
  if (maxDuration) q.maxDuration = Number(maxDuration)
  return q
}

// ── Status Filter ──

function matchesStatus(entryStatus: number, filter: string): boolean {
  // Exact: "200", "404"
  const exact = Number(filter)
  if (Number.isFinite(exact)) return entryStatus === exact

  // Class: "2xx", "4xx", "5xx"
  if (/^[1-5]xx$/i.test(filter)) {
    const cls = Number(filter[0])
    return Math.floor(entryStatus / 100) === cls
  }

  // Range: ">=400", ">399", "<500"
  const rangeMatch = filter.match(/^([<>]=?)(\d+)$/)
  if (rangeMatch) {
    const [, op, val] = rangeMatch
    const n = Number(val)
    switch (op) {
      case '>': return entryStatus > n
      case '>=': return entryStatus >= n
      case '<': return entryStatus < n
      case '<=': return entryStatus <= n
    }
  }

  return true
}

// ── Query Requests ──

export function queryRequests(entries: RequestEntry[], params: QueryParams): PaginatedResult<RequestEntry> {
  let filtered = entries

  // Status filter
  if (params.status) {
    const status = params.status
    filtered = filtered.filter((r) => matchesStatus(r.status, status))
  }

  // Path prefix filter
  if (params.path) {
    const prefix = params.path.toLowerCase()
    filtered = filtered.filter((r) => r.path.toLowerCase().includes(prefix))
  }

  // Procedure filter
  if (params.procedure) {
    const proc = params.procedure.toLowerCase()
    filtered = filtered.filter((r) => r.procedures.some((p) => p.procedure.toLowerCase().includes(proc)))
  }

  // Session filter
  if (params.session) {
    const session = params.session
    filtered = filtered.filter((r) => r.sessionId === session)
  }

  // Duration filter
  if (params.minDuration != null) {
    const min = params.minDuration
    filtered = filtered.filter((r) => r.durationMs >= min)
  }
  if (params.maxDuration != null) {
    const max = params.maxDuration
    filtered = filtered.filter((r) => r.durationMs <= max)
  }

  // Full-text search
  if (params.search) {
    const term = params.search.toLowerCase()
    filtered = filtered.filter(
      (r) =>
        r.path?.toLowerCase().includes(term) ||
        r.procedures?.some((p) => p.procedure.toLowerCase().includes(term)) ||
        r.method?.toLowerCase().includes(term) ||
        r.requestId?.includes(term),
    )
  }

  // Sort
  const sortField = params.sort ?? 'timestamp'
  const desc = (params.order ?? 'desc') === 'desc'
  filtered = sortEntries(filtered, sortField, desc)

  // Pagination
  return paginate(filtered, params)
}

// ── Query Errors ──

export function queryErrors(entries: ErrorEntry[], params: QueryParams): PaginatedResult<ErrorEntry> {
  let filtered = entries

  if (params.status) {
    const status = params.status
    filtered = filtered.filter((e) => matchesStatus(e.status, status))
  }

  if (params.procedure) {
    const proc = params.procedure.toLowerCase()
    filtered = filtered.filter((e) => e.procedure.toLowerCase().includes(proc))
  }

  if (params.path) {
    const path = params.path.toLowerCase()
    filtered = filtered.filter((e) => e.procedure.toLowerCase().includes(path))
  }

  if (params.minDuration != null) {
    const min = params.minDuration
    filtered = filtered.filter((e) => e.durationMs >= min)
  }
  if (params.maxDuration != null) {
    const max = params.maxDuration
    filtered = filtered.filter((e) => e.durationMs <= max)
  }

  if (params.search) {
    const term = params.search.toLowerCase()
    filtered = filtered.filter(
      (e) =>
        e.procedure.toLowerCase().includes(term) ||
        e.error.toLowerCase().includes(term) ||
        e.code.toLowerCase().includes(term) ||
        e.requestId.includes(term),
    )
  }

  const sortField = params.sort ?? 'timestamp'
  const desc = (params.order ?? 'desc') === 'desc'
  filtered = sortEntries(filtered, sortField, desc)

  return paginate(filtered, params)
}

// ── Query Tasks ──

export function queryTasks(entries: TaskExecution[], params: QueryParams): PaginatedResult<TaskExecution> {
  let filtered = entries

  if (params.status) {
    const status = params.status
    filtered = filtered.filter((t) => (status === 'error' ? t.status === 'error' : t.status === 'success'))
  }

  if (params.search) {
    const term = params.search.toLowerCase()
    filtered = filtered.filter(
      (t) => t.taskName.toLowerCase().includes(term) || (t.error?.toLowerCase().includes(term) ?? false),
    )
  }

  if (params.minDuration != null) {
    const min = params.minDuration
    filtered = filtered.filter((t) => t.durationMs >= min)
  }

  const sortField = params.sort ?? 'timestamp'
  const desc = (params.order ?? 'desc') === 'desc'
  filtered = sortEntries(filtered, sortField, desc)

  return paginate(filtered, params)
}

// ── Sort ──

function sortEntries<T>(entries: T[], field: string, desc: boolean): T[] {
  const sorted = [...entries]
  sorted.sort((a, b) => {
    const va = (a as any)[field]
    const vb = (b as any)[field]
    if (va == null && vb == null) return 0
    if (va == null) return 1
    if (vb == null) return -1
    if (typeof va === 'number' && typeof vb === 'number') return desc ? vb - va : va - vb
    if (typeof va === 'string' && typeof vb === 'string') return desc ? vb.localeCompare(va) : va.localeCompare(vb)
    return 0
  })
  return sorted
}

// ── Cursor Pagination ──

function paginate<T extends { id: number }>(entries: T[], params: QueryParams): PaginatedResult<T> {
  const limit = params.limit ?? 50
  const total = entries.length

  let start = 0

  if (params.cursor != null) {
    const idx = entries.findIndex((e) => e.id === params.cursor)
    start = idx === -1 ? 0 : idx + 1
  } else if (params.before != null) {
    const idx = entries.findIndex((e) => e.id === params.before)
    start = idx === -1 ? 0 : Math.max(0, idx - limit)
  }

  const data = entries.slice(start, start + limit)
  const hasMore = start + limit < total
  const nextCursor = hasMore && data.length > 0 ? data[data.length - 1]!.id : null
  const prevCursor = start > 0 && data.length > 0 ? data[0]!.id : null

  return { data, total, hasMore, nextCursor, prevCursor }
}
