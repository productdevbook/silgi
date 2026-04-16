/**
 * Request-level tracing — span collection and standalone trace() helper.
 */

import { round } from './utils.ts'

import type { SpanKind, TraceSpan } from './types.ts'

// ── Request Trace (per-request span collector) ──────

export class RequestTrace {
  spans: TraceSpan[] = []
  /** Procedure-level input — set via `setProcedureInput()` or `trace(..., { procedure: { input } })` */
  procedureInput: unknown = undefined
  /** Procedure-level output — set via `setProcedureOutput()` or `trace(..., { procedure: { output } })` */
  procedureOutput: unknown = undefined
  /** @internal Start time — used by integrations (drizzle etc.) for span offset calculation */
  readonly t0 = performance.now()

  async trace<T>(
    name: string,
    fn: () => T | Promise<T>,
    opts?: {
      kind?: SpanKind
      detail?: string
      input?: unknown
      output?: unknown | ((result: T) => unknown)
      procedure?: { input?: unknown; output?: unknown | ((result: T) => unknown) }
    },
  ): Promise<T> {
    const start = performance.now()
    const kind = opts?.kind ?? guessKind(name)
    try {
      const result = await fn()
      this.spans.push({
        name,
        kind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - this.t0),
        detail: opts?.detail,
        input: opts?.input,
        output: typeof opts?.output === 'function' ? (opts.output as (r: T) => unknown)(result) : opts?.output,
      })
      // Write procedure-level data if provided
      if (opts?.procedure) {
        if (opts.procedure.input !== undefined) this.procedureInput = opts.procedure.input
        const po = opts.procedure.output
        if (po !== undefined) this.procedureOutput = typeof po === 'function' ? (po as (r: T) => unknown)(result) : po
      }
      return result
    } catch (err) {
      this.spans.push({
        name,
        kind,
        durationMs: round(performance.now() - start),
        startOffsetMs: round(start - this.t0),
        detail: opts?.detail,
        input: opts?.input,
        error: err instanceof Error ? err.message : String(err),
      })
      if (opts?.procedure?.input !== undefined) this.procedureInput = opts.procedure.input
      throw err
    }
  }

  totalByKind(kind: SpanKind): number {
    let total = 0
    for (const s of this.spans) {
      if (s.kind === kind) total += s.durationMs
    }
    return round(total)
  }
}

function guessKind(name: string): SpanKind {
  const lower = name.toLowerCase()
  if (
    lower.startsWith('db.') ||
    lower.includes('sql') ||
    lower.includes('prisma') ||
    lower.includes('drizzle') ||
    lower.includes('query') ||
    lower.includes('mongo')
  )
    return 'db'
  if (lower.startsWith('http.') || lower.includes('fetch') || lower.includes('api.')) return 'http'
  if (lower.startsWith('cache.') || lower.includes('redis') || lower.includes('memcache')) return 'cache'
  if (lower.includes('queue') || lower.includes('publish') || lower.includes('nats') || lower.includes('kafka'))
    return 'queue'
  if (lower.includes('email') || lower.includes('smtp') || lower.includes('ses')) return 'email'
  if (lower.includes('ai') || lower.includes('llm') || lower.includes('openai') || lower.includes('gemini')) return 'ai'
  return 'custom'
}

/**
 * Standalone trace function — works with or without analytics.
 *
 * ```ts
 * import { trace } from 'silgi/analytics'
 *
 * const listUsers = s.$resolve(async ({ ctx }) => {
 *   return await trace(ctx, 'db.users.findMany', () => db.users.findMany())
 *   // or with explicit kind:
 *   return await trace(ctx, 'findUsers', () => db.users.findMany(), { kind: 'db', detail: 'SELECT * FROM users' })
 * })
 * ```
 */
export async function trace<T>(
  ctx: Record<string, unknown>,
  name: string,
  fn: () => T | Promise<T>,
  opts?: {
    kind?: SpanKind
    detail?: string
    input?: unknown
    output?: unknown | ((result: T) => unknown)
    procedure?: { input?: unknown; output?: unknown | ((result: T) => unknown) }
  },
): Promise<T> {
  const reqTrace = ctx.trace as RequestTrace | undefined
  if (reqTrace) {
    return reqTrace.trace(name, fn, opts)
  }
  return fn()
}
