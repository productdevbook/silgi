/**
 * Normalization functions for analytics data from storage.
 *
 * All data read from persistent storage passes through these functions
 * to ensure type safety and handle schema evolution.
 */

import { asRecord } from './utils.ts'

import type { ErrorEntry, ProcedureCall, RequestEntry, SpanKind, TraceSpan } from './types.ts'

function normalizeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function normalizeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeStringMap(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) return {}
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string') result[key] = raw
  }
  return result
}

function normalizeSpanKind(value: unknown): SpanKind {
  switch (value) {
    case 'db':
    case 'http':
    case 'cache':
    case 'queue':
    case 'email':
    case 'ai':
    case 'custom':
      return value
    default:
      return 'custom'
  }
}

function normalizeTraceSpans(value: unknown): TraceSpan[] {
  if (!Array.isArray(value)) return []
  const spans: TraceSpan[] = []

  for (const entry of value) {
    const span = asRecord(entry)
    if (!span) continue

    const attributes = asRecord(span.attributes)
    const normalizedAttributes: Record<string, string | number | boolean> = {}
    if (attributes) {
      for (const [key, raw] of Object.entries(attributes)) {
        if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
          normalizedAttributes[key] = raw
        }
      }
    }

    spans.push({
      name: normalizeString(span.name, 'unknown'),
      kind: normalizeSpanKind(span.kind),
      durationMs: normalizeNumber(span.durationMs),
      startOffsetMs: typeof span.startOffsetMs === 'number' ? span.startOffsetMs : undefined,
      detail: typeof span.detail === 'string' ? span.detail : undefined,
      input: span.input,
      output: span.output,
      error: typeof span.error === 'string' ? span.error : undefined,
      attributes: Object.keys(normalizedAttributes).length > 0 ? normalizedAttributes : undefined,
    })
  }

  return spans
}

function inferPathFromUrl(url: string): string {
  if (!url) return ''
  try {
    return new URL(url).pathname || ''
  } catch {
    return ''
  }
}

function normalizeProcedureCall(
  value: unknown,
  fallback: Pick<RequestEntry, 'path' | 'durationMs' | 'status'>,
): ProcedureCall {
  const record = asRecord(value)
  const procedure = normalizeString(record?.procedure, fallback.path.replace(/^\//, '') || fallback.path || 'request')

  return {
    procedure,
    durationMs: normalizeNumber(record?.durationMs, fallback.durationMs),
    status: normalizeNumber(record?.status, fallback.status),
    input: record?.input ?? null,
    output: record?.output ?? null,
    spans: normalizeTraceSpans(record?.spans),
    error: typeof record?.error === 'string' ? record.error : undefined,
  }
}

export function normalizeRequestEntry(value: unknown, fallbackId: number): RequestEntry | null {
  const record = asRecord(value)
  if (!record) return null

  const url = normalizeString(record.url)
  const path = normalizeString(record.path, inferPathFromUrl(url))
  const method = normalizeString(record.method, 'GET')
  const status = normalizeNumber(record.status, 200)
  const durationMs = normalizeNumber(record.durationMs)
  const procedureFallback = {
    path: path || '/',
    durationMs,
    status,
  }

  const proceduresRaw = Array.isArray(record.procedures) ? record.procedures : []
  const procedures =
    proceduresRaw.length > 0
      ? proceduresRaw.map((entry) => normalizeProcedureCall(entry, procedureFallback))
      : [normalizeProcedureCall(null, procedureFallback)]

  return {
    id: normalizeNumber(record.id, fallbackId),
    requestId: normalizeString(record.requestId, String(normalizeNumber(record.id, fallbackId))),
    sessionId: normalizeString(record.sessionId),
    timestamp: normalizeNumber(record.timestamp),
    durationMs,
    method,
    url: url || path,
    path,
    ip: normalizeString(record.ip),
    headers: normalizeStringMap(record.headers),
    responseHeaders: normalizeStringMap(record.responseHeaders),
    userAgent: normalizeString(record.userAgent),
    status,
    procedures,
    isBatch: normalizeBoolean(record.isBatch, procedures.length > 1),
    traceId: normalizeString(record.traceId) || undefined,
    parentRequestId: normalizeString(record.parentRequestId) || undefined,
  }
}

export function normalizeErrorEntry(value: unknown, fallbackId: number): ErrorEntry | null {
  const record = asRecord(value)
  if (!record) return null

  return {
    id: normalizeNumber(record.id, fallbackId),
    requestId: normalizeString(record.requestId),
    timestamp: normalizeNumber(record.timestamp),
    procedure: normalizeString(record.procedure, 'request'),
    error: normalizeString(record.error, 'Unknown error'),
    code: normalizeString(record.code, 'INTERNAL_SERVER_ERROR'),
    status: normalizeNumber(record.status, 500),
    stack: normalizeString(record.stack),
    input: record.input ?? null,
    headers: normalizeStringMap(record.headers),
    durationMs: normalizeNumber(record.durationMs),
    spans: normalizeTraceSpans(record.spans),
  }
}

export function normalizeRequestEntries(value: unknown): RequestEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry, index) => normalizeRequestEntry(entry, index + 1))
    .filter((entry): entry is RequestEntry => entry !== null)
}

export function normalizeErrorEntries(value: unknown): ErrorEntry[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry, index) => normalizeErrorEntry(entry, index + 1))
    .filter((entry): entry is ErrorEntry => entry !== null)
}
