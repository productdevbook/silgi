/**
 * RequestAccumulator — HTTP-level request grouping.
 *
 * Collects procedure calls within a single HTTP request.
 * Created at the start of handleRequest, procedures are added as they complete,
 * then flushed to the collector at the end.
 */

import { parse as parseCookieHeader } from 'cookie-es'

import { parseUrlPath } from '../../core/url.ts'

import { generateRequestId } from './request-id.ts'
import { redactHeaderValue, round } from './utils.ts'

import type { AnalyticsCollector } from './collector.ts'
import type { ProcedureCall, RequestEntry } from './types.ts'

const SESSION_COOKIE = '_sid'
const SESSION_MAX_AGE = 365 * 24 * 60 * 60 // 1 year

export class RequestAccumulator {
  readonly requestId: string
  readonly sessionId: string
  readonly traceId: string
  readonly parentRequestId?: string
  /** True if a new session cookie needs to be set. */
  readonly isNewSession: boolean
  t0: number
  #request: Request
  #procedures: ProcedureCall[] = []
  #collector: AnalyticsCollector

  constructor(request: Request, collector: AnalyticsCollector, traceId?: string, parentRequestId?: string) {
    this.requestId = generateRequestId()
    this.traceId = traceId ?? this.requestId
    this.parentRequestId = parentRequestId
    this.t0 = performance.now()
    this.#request = request
    this.#collector = collector

    // Read or generate session ID from cookie
    const cookieHeader = request.headers.get('cookie')
    const existing = cookieHeader ? parseCookieHeader(cookieHeader)[SESSION_COOKIE] : undefined
    if (existing && existing.length >= 10) {
      this.sessionId = existing
      this.isNewSession = false
    } else {
      this.sessionId = generateRequestId() // same Snowflake format — unique, time-sorted
      this.isNewSession = true
    }
  }

  addProcedure(call: ProcedureCall): void {
    this.#procedures.push(call)
  }

  /** Get Set-Cookie header value (only if new session). */
  getSessionCookie(): string | null {
    if (!this.isNewSession) return null
    return `${SESSION_COOKIE}=${this.sessionId}; Path=/; Max-Age=${SESSION_MAX_AGE}; SameSite=Lax; HttpOnly`
  }

  /** Flush with response headers extracted from the actual Response object. */
  flushWithResponse(res: Response): void {
    if (this.#procedures.length === 0) return

    const durationMs = round(performance.now() - this.t0)
    const headers: Record<string, string> = {}
    this.#request.headers.forEach((v, k) => {
      headers[k] = redactHeaderValue(k, v)
    })

    // Capture actual response headers
    const responseHeaders: Record<string, string> = {}
    res.headers.forEach((v, k) => {
      responseHeaders[k] = redactHeaderValue(k, v)
    })

    let worstStatus = 200
    for (const p of this.#procedures) {
      if (p.status > worstStatus) worstStatus = p.status
    }

    const path = parseUrlPath(this.#request.url)

    this.#collector.recordDetailedRequest({
      requestId: this.requestId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      durationMs,
      method: this.#request.method,
      url: this.#request.url,
      path,
      ip: headers['x-forwarded-for'] || headers['x-real-ip'] || '',
      headers,
      responseHeaders,
      userAgent: this.#request.headers.get('user-agent') ?? '',
      status: worstStatus,
      procedures: this.#procedures,
      isBatch: this.#procedures.length > 1,
      traceId: this.traceId,
      parentRequestId: this.parentRequestId,
    })
  }

  /** Whether any procedures have been recorded. */
  get hasProcedures(): boolean {
    return this.#procedures.length > 0
  }
}
