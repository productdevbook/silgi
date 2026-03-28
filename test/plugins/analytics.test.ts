import { afterEach, describe, expect, it } from 'vitest'

import { resetStorage } from '#src/core/storage.ts'
import { AnalyticsCollector, RequestTrace, analyticsHTML, errorToMarkdown, trace } from '#src/plugins/analytics.ts'

afterEach(() => resetStorage())

describe('AnalyticsCollector', () => {
  it('records requests and computes stats', () => {
    const collector = new AnalyticsCollector()

    collector.record('health', 1.5)
    collector.record('health', 2.0)
    collector.record('health', 3.0)
    collector.record('users/list', 5.0)

    const snap = collector.toJSON()
    expect(snap.totalRequests).toBe(4)
    expect(snap.totalErrors).toBe(0)
    expect(snap.errorRate).toBe(0)
    expect(snap.procedures.health).toBeDefined()
    expect(snap.procedures.health!.count).toBe(3)
    expect(snap.procedures['users/list']!.count).toBe(1)
  })

  it('records errors with count and latency', () => {
    const collector = new AnalyticsCollector()

    collector.record('echo', 1.0)
    collector.record('echo', 2.0)
    collector.recordError('echo', 3.0, 'validation failed')

    const snap = collector.toJSON()
    expect(snap.totalRequests).toBe(3)
    expect(snap.totalErrors).toBe(1)
    expect(snap.procedures.echo!.count).toBe(3)
    expect(snap.procedures.echo!.errors).toBe(1)
    expect(snap.procedures.echo!.latency.avg).toBeCloseTo(2, 0)
    expect(snap.procedures.echo!.lastError).toBe('validation failed')
    expect(snap.procedures.echo!.lastErrorTime).toBeGreaterThan(0)
  })

  it('computes latency percentiles', () => {
    const collector = new AnalyticsCollector({ bufferSize: 128 })

    for (let i = 1; i <= 100; i++) {
      collector.record('test', i)
    }

    const snap = collector.toJSON()
    const lat = snap.procedures.test!.latency
    expect(lat.p50).toBe(50)
    expect(lat.p95).toBe(95)
    expect(lat.p99).toBe(99)
    expect(lat.avg).toBe(50.5)
  })

  it('ring buffer wraps around correctly', () => {
    const collector = new AnalyticsCollector({ bufferSize: 8 })

    for (let i = 1; i <= 16; i++) {
      collector.record('test', i)
    }

    const snap = collector.toJSON()
    expect(snap.procedures.test!.count).toBe(16)
    const lat = snap.procedures.test!.latency
    expect(lat.avg).toBe(12.5)
    expect(lat.p50).toBe(12)
  })

  it('computes error rate correctly', () => {
    const collector = new AnalyticsCollector()

    for (let i = 0; i < 10; i++) collector.record('api', 1.0)
    for (let i = 0; i < 3; i++) collector.recordError('api', 1.0, 'fail')

    const snap = collector.toJSON()
    expect(snap.procedures.api!.errors).toBe(3)
    expect(snap.procedures.api!.count).toBe(13)
    expect(snap.procedures.api!.errorRate).toBeCloseTo(23.08, 1)
    expect(snap.totalRequests).toBe(13)
    expect(snap.totalErrors).toBe(3)
    expect(snap.errorRate).toBeCloseTo(23.08, 1)
  })

  it('handles no requests gracefully', () => {
    const collector = new AnalyticsCollector()
    const snap = collector.toJSON()

    expect(snap.totalRequests).toBe(0)
    expect(snap.totalErrors).toBe(0)
    expect(snap.errorRate).toBe(0)
    expect(snap.requestsPerSecond).toBe(0)
    expect(snap.avgLatency).toBe(0)
    expect(Object.keys(snap.procedures)).toHaveLength(0)
  })

  it('tracks time series windows', () => {
    const collector = new AnalyticsCollector()

    collector.record('a', 1.0)
    collector.record('a', 2.0)

    const snap = collector.toJSON()
    expect(snap.timeSeries.length).toBeGreaterThanOrEqual(1)
    expect(snap.timeSeries[snap.timeSeries.length - 1]!.count).toBeGreaterThanOrEqual(2)
  })

  it('stores detailed errors', async () => {
    const collector = new AnalyticsCollector({ maxErrors: 5 })

    collector.recordDetailedError({
      timestamp: Date.now(),
      procedure: 'users/create',
      error: 'Unauthorized',
      code: 'UNAUTHORIZED',
      status: 401,
      stack: 'Error: Unauthorized\n    at auth (server.ts:22)',
      input: { name: 'Alice' },
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      durationMs: 1.23,
      spans: [{ name: 'db.users.find', durationMs: 0.5 }],
    })

    const errors = await collector.getErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.id).toBe(1)
    expect(errors[0]!.procedure).toBe('users/create')
    expect(errors[0]!.code).toBe('UNAUTHORIZED')
    expect(errors[0]!.input).toEqual({ name: 'Alice' })
    expect(errors[0]!.spans).toHaveLength(1)
    expect(errors[0]!.spans[0]!.name).toBe('db.users.find')
  })

  it('limits error log to maxErrors', async () => {
    const collector = new AnalyticsCollector({ maxErrors: 3 })

    for (let i = 0; i < 5; i++) {
      collector.recordDetailedError({
        timestamp: Date.now(),
        procedure: `proc${i}`,
        error: `error${i}`,
        code: 'ERR',
        status: 500,
        stack: '',
        input: null,
        headers: {},
        durationMs: 1,
        spans: [],
      })
    }

    // Flush to storage then read back
    await collector.dispose()
    const errors = await collector.getErrors()
    expect(errors).toHaveLength(3)
    expect(errors[0]!.procedure).toBe('proc2') // first 2 evicted
    expect(errors[2]!.procedure).toBe('proc4')
  })

  it('stores detailed requests via recordDetailedRequest', async () => {
    const collector = new AnalyticsCollector()

    collector.recordDetailedRequest({
      timestamp: 1711018800000,
      procedure: 'users/list',
      durationMs: 4.56,
      status: 200,
      input: { page: 1 },
      spans: [
        { name: 'db.users.findMany', durationMs: 3.2 },
        { name: 'cache.set', durationMs: 0.8 },
      ],
    })

    const requests = await collector.getRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.id).toBe(1)
    expect(requests[0]!.procedure).toBe('users/list')
    expect(requests[0]!.durationMs).toBe(4.56)
    expect(requests[0]!.status).toBe(200)
    expect(requests[0]!.input).toEqual({ page: 1 })
    expect(requests[0]!.spans).toHaveLength(2)
    expect(requests[0]!.spans[0]!.name).toBe('db.users.findMany')
    expect(requests[0]!.spans[1]!.name).toBe('cache.set')
  })

  it('getRequests returns all stored entries', async () => {
    const collector = new AnalyticsCollector()

    for (let i = 0; i < 3; i++) {
      collector.recordDetailedRequest({
        timestamp: Date.now(),
        procedure: `proc${i}`,
        durationMs: i + 1,
        status: 200,
        input: null,
        spans: [],
      })
    }

    const requests = await collector.getRequests()
    expect(requests).toHaveLength(3)
    expect(requests.map((r) => r.procedure)).toEqual(['proc0', 'proc1', 'proc2'])
    // IDs are auto-incrementing
    expect(requests.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('limits request log to maxRequests (oldest dropped)', async () => {
    const collector = new AnalyticsCollector({ maxRequests: 3 })

    for (let i = 0; i < 5; i++) {
      collector.recordDetailedRequest({
        timestamp: Date.now(),
        procedure: `req${i}`,
        durationMs: 1,
        status: 200,
        input: null,
        spans: [],
      })
    }

    await collector.dispose()
    const requests = await collector.getRequests()
    expect(requests).toHaveLength(3)
    expect(requests[0]!.procedure).toBe('req2') // first 2 evicted
    expect(requests[1]!.procedure).toBe('req3')
    expect(requests[2]!.procedure).toBe('req4')
  })

  it('RequestEntry has correct shape with all fields', async () => {
    const collector = new AnalyticsCollector()

    collector.recordDetailedRequest({
      timestamp: 1711018800000,
      procedure: 'echo',
      durationMs: 2.5,
      status: 200,
      input: { msg: 'hello' },
      spans: [{ name: 'db.query', durationMs: 1.0, error: 'timeout' }],
    })

    const requests = await collector.getRequests()
    expect(requests[0]).toEqual({
      id: 1,
      timestamp: 1711018800000,
      procedure: 'echo',
      durationMs: 2.5,
      status: 200,
      input: { msg: 'hello' },
      spans: [{ name: 'db.query', durationMs: 1.0, error: 'timeout' }],
    })
  })
})

describe('RequestTrace', () => {
  it('records spans for traced operations', async () => {
    const rt = new RequestTrace()

    const result = await rt.trace('db.query', () => Promise.resolve([1, 2, 3]))
    expect(result).toEqual([1, 2, 3])
    expect(rt.spans).toHaveLength(1)
    expect(rt.spans[0]!.name).toBe('db.query')
    expect(rt.spans[0]!.durationMs).toBeGreaterThanOrEqual(0)
    expect(rt.spans[0]!.error).toBeUndefined()
  })

  it('records error spans', async () => {
    const rt = new RequestTrace()

    await expect(rt.trace('db.fail', () => Promise.reject(new Error('connection lost')))).rejects.toThrow(
      'connection lost',
    )

    expect(rt.spans).toHaveLength(1)
    expect(rt.spans[0]!.name).toBe('db.fail')
    expect(rt.spans[0]!.error).toBe('connection lost')
  })

  it('records multiple spans', async () => {
    const rt = new RequestTrace()

    await rt.trace('db.users', () => Promise.resolve('users'))
    await rt.trace('cache.set', () => Promise.resolve(true))
    await rt.trace('api.notify', () => Promise.resolve('ok'))

    expect(rt.spans).toHaveLength(3)
    expect(rt.spans.map((s) => s.name)).toEqual(['db.users', 'cache.set', 'api.notify'])
  })
})

describe('trace() standalone helper', () => {
  it('uses RequestTrace when available on context', async () => {
    const rt = new RequestTrace()
    const ctx: Record<string, unknown> = { __analyticsTrace: rt }

    const result = await trace(ctx, 'db.find', () => Promise.resolve(42))
    expect(result).toBe(42)
    expect(rt.spans).toHaveLength(1)
    expect(rt.spans[0]!.name).toBe('db.find')
  })

  it('runs function directly when analytics is disabled', async () => {
    const ctx: Record<string, unknown> = {}

    const result = await trace(ctx, 'db.find', () => Promise.resolve(42))
    expect(result).toBe(42)
  })
})

describe('errorToMarkdown', () => {
  it('generates markdown with all sections', () => {
    const md = errorToMarkdown({
      id: 1,
      timestamp: 1711018800000,
      procedure: 'users/create',
      error: 'User not found',
      code: 'NOT_FOUND',
      status: 404,
      stack: 'Error: User not found\n    at resolve (server.ts:42)',
      input: { name: 'Alice', email: 'alice@test.com' },
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
      durationMs: 2.34,
      spans: [
        { name: 'db.users.find', durationMs: 1.2 },
        { name: 'cache.get', durationMs: 0.3, error: 'cache miss' },
      ],
    })

    expect(md).toContain('## Error in `users/create`')
    expect(md).toContain('**Error:** NOT_FOUND')
    expect(md).toContain('**Status:** 404')
    expect(md).toContain('**Duration:** 2.34ms')
    expect(md).toContain('```json')
    expect(md).toContain('"Alice"')
    expect(md).toContain('### Stack Trace')
    expect(md).toContain('server.ts:42')
    expect(md).toContain('`authorization`: `[REDACTED]`')
    expect(md).toContain('### Traced Operations')
    expect(md).toContain('db.users.find')
    expect(md).toContain('cache miss')
  })
})

describe('AnalyticsCollector — persistence via default useStorage', () => {
  it('persists requests to default storage on flush', async () => {
    const collector = new AnalyticsCollector({ flushInterval: 999_999 })

    collector.recordDetailedRequest({
      timestamp: Date.now(),
      procedure: 'users/list',
      durationMs: 2.0,
      status: 200,
      input: null,
      spans: [],
    })

    await collector.dispose()

    // New collector — same global storage, data survives
    const collector2 = new AnalyticsCollector({ flushInterval: 999_999 })
    const requests = await collector2.getRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.procedure).toBe('users/list')
    await collector2.dispose()
  })

  it('persists errors to default storage on flush', async () => {
    const collector = new AnalyticsCollector({ flushInterval: 999_999 })

    collector.recordDetailedError({
      requestId: 'test-req',
      timestamp: Date.now(),
      procedure: 'users/create',
      error: 'fail',
      code: 'ERR',
      status: 500,
      stack: '',
      input: null,
      headers: {},
      durationMs: 1,
      spans: [],
    })

    await collector.dispose()

    const collector2 = new AnalyticsCollector({ flushInterval: 999_999 })
    const errors = await collector2.getErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.procedure).toBe('users/create')
    await collector2.dispose()
  })

  it('persists and restores counters', async () => {
    const collector = new AnalyticsCollector({ flushInterval: 999_999 })

    collector.record('a', 1)
    collector.record('a', 2)
    collector.recordError('a', 3, 'err')
    collector.recordDetailedRequest({
      timestamp: Date.now(),
      procedure: 'a',
      durationMs: 1,
      status: 200,
      input: null,
      spans: [],
    })

    await collector.dispose()

    const collector2 = new AnalyticsCollector({ flushInterval: 999_999 })
    await new Promise((r) => setTimeout(r, 10))
    const snap = collector2.toJSON()
    expect(snap.totalRequests).toBe(3)
    expect(snap.totalErrors).toBe(1)
    await collector2.dispose()
  })

  it('merges pending and stored entries', async () => {
    const c1 = new AnalyticsCollector({ flushInterval: 999_999 })
    c1.recordDetailedRequest({ timestamp: 1, procedure: 'a', durationMs: 1, status: 200, input: null, spans: [] })
    c1.recordDetailedRequest({ timestamp: 2, procedure: 'b', durationMs: 2, status: 200, input: null, spans: [] })
    await c1.dispose()

    const c2 = new AnalyticsCollector({ flushInterval: 999_999 })
    c2.recordDetailedRequest({ timestamp: 3, procedure: 'c', durationMs: 3, status: 200, input: null, spans: [] })

    const requests = await c2.getRequests()
    expect(requests).toHaveLength(3)
    expect(requests.map((r) => r.procedure)).toEqual(['a', 'b', 'c'])
    await c2.dispose()
  })

  it('trims to maxRequests on flush', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999, maxRequests: 3 })

    for (let i = 0; i < 5; i++) {
      c.recordDetailedRequest({ timestamp: i, procedure: `r${i}`, durationMs: 1, status: 200, input: null, spans: [] })
    }

    await c.dispose()

    const c2 = new AnalyticsCollector({ flushInterval: 999_999, maxRequests: 3 })
    const requests = await c2.getRequests()
    expect(requests).toHaveLength(3)
    expect(requests[0]!.procedure).toBe('r2')
    await c2.dispose()
  })
})

describe('analyticsHTML', () => {
  it('returns HTML dashboard', () => {
    const html = analyticsHTML()

    // Built React dashboard or fallback — both are valid HTML
    expect(html).toMatch(/<!doctype html>/i)
    expect(html).toContain('<html')
    expect(html).toContain('</html>')
  })
})
