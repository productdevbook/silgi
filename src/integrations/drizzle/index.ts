/**
 * Silgi + Drizzle ORM tracing integration.
 *
 * Wraps Drizzle session methods to intercept every query and record
 * spans in silgi analytics. Uses AsyncLocalStorage to bridge request
 * context to the DB layer.
 *
 * Patching priority (inspired by @kubiks/otel-drizzle):
 * 1. `db.session.prepareQuery` — wrap returned prepared.execute (main ORM path)
 * 2. `db.session.query` — for direct string queries
 * 3. `db.session.transaction` — re-instrument tx session per transaction call
 * 4. `db.$client.query` or `db.$client.execute` — fallback to raw driver
 * 5. `db._.session.execute` — deep internal fallback
 *
 * Instance patching, NOT prototype patching. Idempotent via flag.
 *
 * @example
 * ```ts
 * import { instrumentDrizzle, withSilgiCtx } from 'silgi/drizzle'
 *
 * const db = instrumentDrizzle(drizzle(url, { schema }), {
 *   dbName: 'ecommerce',
 *   peerName: 'db.example.com',
 *   peerPort: 5432,
 * })
 *
 * const listUsers = s.$resolve(async ({ ctx }) => {
 *   return withSilgiCtx(ctx, () => db.select().from(users))
 * })
 * ```
 */
import { AsyncLocalStorage } from 'node:async_hooks'

import type { RequestTrace, SpanKind } from '../../plugins/analytics.ts'

// ── Constants ────────────────────────────────────────

const ctxStorage = new AsyncLocalStorage<Record<string, unknown>>()
const INSTRUMENTED = '__silgiDrizzleInstrumented'
const DEFAULT_DB_SYSTEM = 'postgresql'
const DEFAULT_MAX_QUERY_LENGTH = 1000

// ── Config ───────────────────────────────────────────

export interface InstrumentDrizzleConfig {
  /** Logical database name (e.g. 'auth', 'ecommerce') */
  dbName?: string
  /** Database system identifier. Default: 'postgresql' */
  dbSystem?: string
  /** Capture SQL query text in spans. Default: true */
  captureQueryText?: boolean
  /** Max query text length before truncation. Default: 1000 */
  maxQueryTextLength?: number
  /** Database host */
  peerName?: string
  /** Database port */
  peerPort?: number
}

// ── Public API ───────────────────────────────────────

/**
 * Instrument a Drizzle db instance to record query spans in silgi analytics.
 * Returns the same db instance (mutated). Safe to call multiple times.
 */
export function instrumentDrizzle<T extends Record<string, any>>(db: T, config?: InstrumentDrizzleConfig): T {
  if (!db || (db as any)[INSTRUMENTED]) return db

  const cfg = resolveConfig(config)
  let instrumented = false

  // Priority 1–3: Session-level patching (main ORM path)
  const session = (db as any).session ?? (db as any)._?.session
  if (session) {
    instrumented = patchSession(session, cfg, false)
  }

  // Priority 4: Raw driver client ($client.query / $client.execute)
  if (!instrumented && (db as any).$client) {
    instrumented = patchRawClient((db as any).$client, cfg)
  }

  // Priority 5: Deep internal fallback (db._.session.execute)
  if (!instrumented && (db as any)._?.session && typeof (db as any)._.session.execute === 'function') {
    instrumented = patchSessionExecute((db as any)._.session, cfg)
  }

  if (!instrumented) {
    console.warn('[silgi/drizzle] Could not find any patchable method — skipping instrumentation')
    return db
  }

  ;(db as any)[INSTRUMENTED] = true
  return db
}

/**
 * Run a function with silgi context available to instrumented Drizzle instances.
 * All Drizzle queries inside `fn` will be recorded as trace spans.
 */
export function withSilgiCtx<T>(ctx: Record<string, unknown>, fn: () => T): T {
  return ctxStorage.run(ctx, fn)
}

// ── Config Resolution ────────────────────────────────

interface ResolvedConfig {
  dbSystem: string
  dbName: string | undefined
  captureQueryText: boolean
  maxQueryTextLength: number
  peerName: string | undefined
  peerPort: number | undefined
}

function resolveConfig(config?: InstrumentDrizzleConfig): ResolvedConfig {
  return {
    dbSystem: config?.dbSystem ?? DEFAULT_DB_SYSTEM,
    dbName: config?.dbName,
    captureQueryText: config?.captureQueryText !== false,
    maxQueryTextLength: config?.maxQueryTextLength ?? DEFAULT_MAX_QUERY_LENGTH,
    peerName: config?.peerName,
    peerPort: config?.peerPort,
  }
}

// ── Session Patching ─────────────────────────────────

/**
 * Patch session.prepareQuery, session.query, and session.transaction.
 * Returns true if any method was patched.
 */
function patchSession(session: any, cfg: ResolvedConfig, isTx: boolean): boolean {
  const flagSuffix = isTx ? '_tx' : ''
  if (session[INSTRUMENTED + flagSuffix]) return true

  let patched = false

  // 1. session.prepareQuery — main ORM path (select/insert/update/delete)
  if (typeof session.prepareQuery === 'function') {
    const originalPrepareQuery = session.prepareQuery.bind(session)

    session.prepareQuery = function patchedPrepareQuery(this: any, ...args: any[]) {
      const prepared = originalPrepareQuery.apply(this, args)
      if (!prepared || typeof prepared.execute !== 'function') return prepared

      const ctx = ctxStorage.getStore()
      const reqTrace = ctx?.__analyticsTrace as RequestTrace | undefined
      if (!reqTrace) return prepared

      const queryText =
        extractQueryText(args[0]) ?? prepared.rawQueryConfig?.text ?? prepared.queryConfig?.text ?? null

      const originalExecute = prepared.execute.bind(prepared)

      prepared.execute = function tracedExecute(this: any, ...execArgs: any[]) {
        return traceExecution(reqTrace, cfg, queryText, isTx, originalExecute, this, execArgs)
      }

      return prepared
    }

    patched = true
  }

  // 2. session.query — direct string queries
  if (typeof session.query === 'function') {
    const originalQuery = session.query.bind(session)

    session.query = function patchedQuery(this: any, queryString: string, params: any[]) {
      const ctx = ctxStorage.getStore()
      const reqTrace = ctx?.__analyticsTrace as RequestTrace | undefined
      if (!reqTrace) return originalQuery.call(this, queryString, params)

      return traceExecution(reqTrace, cfg, queryString ?? null, isTx, originalQuery, this, [queryString, params])
    }

    patched = true
  }

  // 3. session.transaction — re-instrument tx session per call
  if (!isTx && typeof session.transaction === 'function') {
    const originalTransaction = session.transaction.bind(session)

    session.transaction = function patchedTransaction(this: any, callback: any, txConfig?: any) {
      return originalTransaction.call(
        this,
        (tx: any) => {
          const txSession = tx.session ?? tx
          if (txSession && typeof txSession.prepareQuery === 'function') {
            patchSession(txSession, cfg, true)
          }
          return callback(tx)
        },
        txConfig,
      )
    }

    patched = true
  }

  if (patched) {
    session[INSTRUMENTED + flagSuffix] = true
  }

  return patched
}

// ── Raw Client Patching (Priority 4) ─────────────────

/**
 * Patch $client.query or $client.execute as fallback for raw driver access.
 */
function patchRawClient(client: any, cfg: ResolvedConfig): boolean {
  if (!client || client[INSTRUMENTED]) return false

  const methodName = typeof client.query === 'function' ? 'query' : typeof client.execute === 'function' ? 'execute' : null

  if (!methodName) return false

  const originalMethod = client[methodName].bind(client)

  client[methodName] = function patchedClientMethod(this: any, ...args: any[]) {
    const ctx = ctxStorage.getStore()
    const reqTrace = ctx?.__analyticsTrace as RequestTrace | undefined
    if (!reqTrace) return originalMethod.apply(this, args)

    const queryText = extractQueryText(args[0])
    return traceExecution(reqTrace, cfg, queryText ?? null, false, originalMethod, this, args)
  }

  client[INSTRUMENTED] = true
  return true
}

// ── Session Execute Patching (Priority 5) ────────────

/**
 * Patch db._.session.execute as deep internal fallback.
 */
function patchSessionExecute(session: any, cfg: ResolvedConfig): boolean {
  if (session[INSTRUMENTED]) return false

  const originalExecute = session.execute.bind(session)

  session.execute = function patchedDeepExecute(this: any, ...args: any[]) {
    const ctx = ctxStorage.getStore()
    const reqTrace = ctx?.__analyticsTrace as RequestTrace | undefined
    if (!reqTrace) return originalExecute.apply(this, args)

    const queryText = extractQueryText(args[0])
    return traceExecution(reqTrace, cfg, queryText ?? null, false, originalExecute, this, args)
  }

  session[INSTRUMENTED] = true
  return true
}

// ── Core Trace Execution ─────────────────────────────

/**
 * Execute a function and record a trace span with timing, attributes, and error handling.
 * Handles both sync and async (Promise) return values.
 */
function traceExecution(
  reqTrace: RequestTrace,
  cfg: ResolvedConfig,
  queryText: string | null,
  isTx: boolean,
  fn: (...args: any[]) => any,
  thisArg: any,
  args: any[],
): any {
  const spanName = buildSpanName(queryText, isTx)
  const attributes = buildAttributes(cfg, queryText, isTx)
  const start = performance.now()

  try {
    const result = fn.apply(thisArg, args)

    if (result instanceof Promise) {
      return result.then(
        (value: unknown) => {
          pushSpan(reqTrace, spanName, start, queryText, cfg, attributes, undefined)
          return value
        },
        (error: unknown) => {
          pushSpan(reqTrace, spanName, start, queryText, cfg, attributes, error)
          throw error
        },
      )
    }

    pushSpan(reqTrace, spanName, start, queryText, cfg, attributes, undefined)
    return result
  } catch (error) {
    pushSpan(reqTrace, spanName, start, queryText, cfg, attributes, error)
    throw error
  }
}

// ── Span Builder ─────────────────────────────────────

function pushSpan(
  reqTrace: RequestTrace,
  name: string,
  start: number,
  queryText: string | null,
  cfg: ResolvedConfig,
  attributes: Record<string, string | number | boolean>,
  error: unknown,
): void {
  const detail =
    cfg.captureQueryText && queryText ? truncateQuery(queryText, cfg.maxQueryTextLength) : undefined

  reqTrace.spans.push({
    name,
    kind: 'db' as SpanKind,
    durationMs: round(performance.now() - start),
    startOffsetMs: round(start - reqTrace.t0),
    detail,
    attributes,
    error: error ? formatError(error) : undefined,
  })
}

function buildAttributes(
  cfg: ResolvedConfig,
  queryText: string | null,
  isTx: boolean,
): Record<string, string | number | boolean> {
  const attrs: Record<string, string | number | boolean> = {
    'db.system': cfg.dbSystem,
  }

  if (cfg.dbName) attrs['db.name'] = cfg.dbName
  if (cfg.peerName) attrs['net.peer.name'] = cfg.peerName
  if (cfg.peerPort) attrs['net.peer.port'] = cfg.peerPort
  if (isTx) attrs['db.transaction'] = true

  if (queryText) {
    const op = extractOperationName(queryText)
    if (op) attrs['db.operation'] = op
    if (cfg.captureQueryText) {
      attrs['db.statement'] = truncateQuery(queryText, cfg.maxQueryTextLength)
    }
  }

  return attrs
}

// ── Span Naming ──────────────────────────────────────
//
// Better than kubiks: includes table name for richer traces.
//   db.select.users, db.insert.order
//   db.tx.select.users (inside transactions)

function buildSpanName(queryText: string | null, isTx: boolean): string {
  const prefix = isTx ? 'db.tx' : 'db'
  if (!queryText) return `${prefix}.query`

  const opInfo = extractOperationInfo(queryText)
  if (!opInfo) return `${prefix}.query`

  return opInfo.table ? `${prefix}.${opInfo.op}.${opInfo.table}` : `${prefix}.${opInfo.op}`
}

// ── Query Text Extraction ────────────────────────────

/**
 * Extract SQL text from various query argument formats:
 * - Plain string
 * - { sql: string }
 * - { text: string }
 * - { queryString: string }
 * - { queryChunks: ..., sql: string }
 */
function extractQueryText(queryArg: unknown): string | null {
  if (typeof queryArg === 'string') return queryArg

  if (queryArg && typeof queryArg === 'object') {
    const q = queryArg as Record<string, unknown>
    if (typeof q.sql === 'string') return q.sql
    if (typeof q.text === 'string') return q.text
    if (typeof q.queryString === 'string') return q.queryString
    // Drizzle SQL objects with queryChunks may also carry .sql
    if (typeof q.queryChunks === 'object' && typeof q.sql === 'string') return q.sql
  }

  return null
}

function truncateQuery(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.slice(0, maxLength) + '...'
}

// ── Operation Extraction ─────────────────────────────

interface OperationInfo {
  op: string
  table: string | null
}

/**
 * Parse the SQL operation and target table from query text.
 * Returns lowercase op name and table for span naming.
 */
function extractOperationInfo(sql: string): OperationInfo | null {
  const upper = sql.trimStart().toUpperCase()

  if (upper.startsWith('SELECT')) {
    return { op: 'select', table: matchTable(sql, /from\s+"?(\w+)"?/i) }
  }
  if (upper.startsWith('INSERT')) {
    return { op: 'insert', table: matchTable(sql, /into\s+"?(\w+)"?/i) }
  }
  if (upper.startsWith('UPDATE')) {
    return { op: 'update', table: matchTable(sql, /update\s+"?(\w+)"?/i) }
  }
  if (upper.startsWith('DELETE')) {
    return { op: 'delete', table: matchTable(sql, /from\s+"?(\w+)"?/i) }
  }
  if (upper.startsWith('BEGIN') || upper.startsWith('START TRANSACTION')) {
    return { op: 'begin', table: null }
  }
  if (upper.startsWith('COMMIT')) {
    return { op: 'commit', table: null }
  }
  if (upper.startsWith('ROLLBACK')) {
    return { op: 'rollback', table: null }
  }

  return null
}

/**
 * Extract uppercase operation name for the db.operation attribute.
 */
function extractOperationName(sql: string): string | null {
  const trimmed = sql.trimStart()
  const match = /^(\w+)/u.exec(trimmed)
  return match ? match[1]!.toUpperCase() : null
}

function matchTable(sql: string, pattern: RegExp): string | null {
  const m = sql.match(pattern)
  return m ? m[1]! : null
}

// ── Error Formatting ─────────────────────────────────

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`
  }
  return String(error)
}

// ── Helpers ──────────────────────────────────────────

function round(n: number): number {
  return Math.round(n * 100) / 100
}
