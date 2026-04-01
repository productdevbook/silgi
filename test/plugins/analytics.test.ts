import { afterEach, describe, expect, it } from 'vitest'

import { resetStorage } from '#src/core/storage.ts'
import { AnalyticsCollector, RequestTrace, analyticsHTML, errorToMarkdown, serveAnalyticsRoute, trace } from '#src/plugins/analytics.ts'

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
    const collector = new AnalyticsCollector()

    collector.recordDetailedError({
      timestamp: Date.now(),
      procedure: 'api/users/create',
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
    expect(errors[0]!.procedure).toBe('api/users/create')
    expect(errors[0]!.code).toBe('UNAUTHORIZED')
    expect(errors[0]!.input).toEqual({ name: 'Alice' })
    expect(errors[0]!.spans).toHaveLength(1)
    expect(errors[0]!.spans[0]!.name).toBe('db.users.find')
  })

  it('retentionDays prunes old errors from storage', async () => {
    const now = Date.now()
    const oneDay = 86_400_000
    const collector = new AnalyticsCollector({ retentionDays: 7 })

    collector.recordDetailedError({
      timestamp: now - 10 * oneDay,
      procedure: 'api/old-fail',
      error: 'old',
      code: 'ERR',
      status: 500,
      stack: '',
      input: null,
      headers: {},
      durationMs: 1,
      spans: [],
    })
    collector.recordDetailedError({
      timestamp: now,
      procedure: 'api/new-fail',
      error: 'new',
      code: 'ERR',
      status: 500,
      stack: '',
      input: null,
      headers: {},
      durationMs: 1,
      spans: [],
    })

    await collector.dispose()
    const errors = await collector.getErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.procedure).toBe('api/new-fail')
  })

  it('stores detailed requests via recordDetailedRequest', async () => {
    const collector = new AnalyticsCollector()

    collector.recordDetailedRequest({
      timestamp: Date.now(),
      path: 'api/users/list',
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
    expect(requests[0]!.path).toBe('api/users/list')
    expect(requests[0]!.durationMs).toBe(4.56)
    expect(requests[0]!.status).toBe(200)
  })

  it('getRequests returns all stored entries', async () => {
    const collector = new AnalyticsCollector()

    for (let i = 0; i < 3; i++) {
      collector.recordDetailedRequest({
        timestamp: Date.now(),
        path: `api/proc${i}`,
        durationMs: i + 1,
        status: 200,
        input: null,
        spans: [],
      })
    }

    const requests = await collector.getRequests()
    expect(requests).toHaveLength(3)
    expect(requests.map((r) => r.path)).toEqual(['api/proc0', 'api/proc1', 'api/proc2'])
    // IDs are auto-incrementing
    expect(requests.map((r) => r.id)).toEqual([1, 2, 3])
  })

  it('retentionDays prunes old requests from storage', async () => {
    const now = Date.now()
    const oneDay = 86_400_000
    const collector = new AnalyticsCollector({ retentionDays: 5 })

    collector.recordDetailedRequest({
      timestamp: now - 10 * oneDay,
      path: 'api/old',
      durationMs: 1,
      status: 200,
      input: null,
      spans: [],
    })
    collector.recordDetailedRequest({
      timestamp: now - 2 * oneDay,
      path: 'api/recent',
      durationMs: 1,
      status: 200,
      input: null,
      spans: [],
    })
    collector.recordDetailedRequest({
      timestamp: now,
      path: 'api/fresh',
      durationMs: 1,
      status: 200,
      input: null,
      spans: [],
    })

    await collector.dispose()
    const requests = await collector.getRequests()
    expect(requests).toHaveLength(2)
    expect(requests.map((r) => r.path)).toEqual(['api/recent', 'api/fresh'])
  })

  it('RequestEntry has correct shape with all fields', async () => {
    const collector = new AnalyticsCollector()

    collector.recordDetailedRequest({
      timestamp: Date.now(),
      path: 'api/echo',
      durationMs: 2.5,
      status: 200,
      input: { msg: 'hello' },
      spans: [{ name: 'db.query', durationMs: 1.0, error: 'timeout' }],
    })

    const requests = await collector.getRequests()
    expect(requests).toHaveLength(1)
    expect(requests[0]!.id).toBe(1)
    expect(requests[0]!.path).toBe('api/echo')
    expect(requests[0]!.durationMs).toBe(2.5)
    expect(requests[0]!.status).toBe(200)
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
    expect(md).toContain('`authorization`: `Bearer token`')
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
      path: 'api/users/list',
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
    expect(requests[0]!.path).toBe('api/users/list')
    await collector2.dispose()
  })

  it('persists errors to default storage on flush', async () => {
    const collector = new AnalyticsCollector({ flushInterval: 999_999 })

    collector.recordDetailedError({
      requestId: 'test-req',
      timestamp: Date.now(),
      procedure: 'api/users/create',
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
    expect(errors[0]!.procedure).toBe('api/users/create')
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
      path: 'api/a',
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
    const now = Date.now()
    const c1 = new AnalyticsCollector({ flushInterval: 999_999 })
    c1.recordDetailedRequest({ timestamp: now - 2000, path: 'api/a', durationMs: 1, status: 200, input: null, spans: [] })
    c1.recordDetailedRequest({ timestamp: now - 1000, path: 'api/b', durationMs: 2, status: 200, input: null, spans: [] })
    await c1.dispose()

    const c2 = new AnalyticsCollector({ flushInterval: 999_999 })
    c2.recordDetailedRequest({ timestamp: now, path: 'api/c', durationMs: 3, status: 200, input: null, spans: [] })

    const requests = await c2.getRequests()
    expect(requests).toHaveLength(3)
    expect(requests.map((r) => r.path)).toEqual(['api/a', 'api/b', 'api/c'])
    await c2.dispose()
  })

  it('retentionDays prunes old entries on flush', async () => {
    const now = Date.now()
    const oneDay = 86_400_000
    const c = new AnalyticsCollector({ flushInterval: 999_999, retentionDays: 7 })

    c.recordDetailedRequest({ timestamp: now - 10 * oneDay, procedure: 'old', path: 'api/old', durationMs: 1, status: 200, input: null, spans: [] })
    c.recordDetailedRequest({ timestamp: now - 3 * oneDay, procedure: 'recent', path: 'api/recent', durationMs: 1, status: 200, input: null, spans: [] })
    c.recordDetailedRequest({ timestamp: now, procedure: 'fresh', path: 'api/fresh', durationMs: 1, status: 200, input: null, spans: [] })

    await c.dispose()

    const c2 = new AnalyticsCollector({ flushInterval: 999_999, retentionDays: 7 })
    const requests = await c2.getRequests()
    expect(requests).toHaveLength(2)
    expect(requests.map((r) => r.path)).toEqual(['api/recent', 'api/fresh'])
    await c2.dispose()
  })

  it('retentionDays prunes old errors on flush', async () => {
    const now = Date.now()
    const oneDay = 86_400_000
    const c = new AnalyticsCollector({ flushInterval: 999_999, retentionDays: 3 })

    c.recordDetailedError({
      requestId: 'old-req',
      timestamp: now - 5 * oneDay,
      procedure: 'api/fail-old',
      error: 'old error',
      code: 'ERR',
      status: 500,
      stack: '',
      input: null,
      headers: {},
      durationMs: 1,
      spans: [],
    })
    c.recordDetailedError({
      requestId: 'new-req',
      timestamp: now,
      procedure: 'api/fail-new',
      error: 'new error',
      code: 'ERR',
      status: 500,
      stack: '',
      input: null,
      headers: {},
      durationMs: 1,
      spans: [],
    })

    await c.dispose()

    const c2 = new AnalyticsCollector({ flushInterval: 999_999, retentionDays: 3 })
    const errors = await c2.getErrors()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.procedure).toBe('api/fail-new')
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

describe('ignorePaths (server-side, config only)', () => {
  it('marks config paths as ignored', () => {
    const c = new AnalyticsCollector({ ignorePaths: ['api/health'] })
    expect(c.isIgnored('api/health')).toBe(true)
    expect(c.isIgnored('api/health/deep')).toBe(true)
    expect(c.isIgnored('api/users')).toBe(false)
  })

  it('normalizes leading slash', () => {
    const c = new AnalyticsCollector({ ignorePaths: ['/api/health'] })
    expect(c.isIgnored('api/health')).toBe(true)
    expect(c.isIgnored('/api/health')).toBe(true)
  })
})

describe('hiddenPaths (client-side, dashboard only)', () => {
  it('adds and removes hidden paths at runtime', () => {
    const c = new AnalyticsCollector()
    expect(c.isHidden('api/health')).toBe(false)

    c.addHiddenPath('api/health')
    expect(c.isHidden('api/health')).toBe(true)
    expect(c.getHiddenPaths()).toContain('api/health')

    c.removeHiddenPath('api/health')
    expect(c.isHidden('api/health')).toBe(false)
  })

  it('persists hidden paths across instances', async () => {
    const c1 = new AnalyticsCollector({ flushInterval: 999_999 })
    c1.addHiddenPath('api/health')
    c1.addHiddenPath('api/metrics')
    await c1.dispose()

    const c2 = new AnalyticsCollector({ flushInterval: 999_999 })
    await new Promise((r) => setTimeout(r, 10))
    expect(c2.getHiddenPaths()).toContain('api/health')
    expect(c2.getHiddenPaths()).toContain('api/metrics')
    await c2.dispose()
  })

  it('filters hidden paths from request and error responses', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999 })
    c.recordDetailedRequest({ timestamp: Date.now(), path: 'api/health', durationMs: 1, status: 200, input: null, spans: [] })
    c.recordDetailedRequest({ timestamp: Date.now(), path: 'api/users', durationMs: 1, status: 200, input: null, spans: [] })
    c.recordDetailedError({ requestId: 'r1', timestamp: Date.now(), procedure: 'api/health', error: 'err', code: 'ERR', status: 500, stack: '', input: null, headers: {}, durationMs: 1, spans: [] })
    c.recordDetailedError({ requestId: 'r2', timestamp: Date.now(), procedure: 'api/users', error: 'err', code: 'ERR', status: 500, stack: '', input: null, headers: {}, durationMs: 1, spans: [] })

    c.addHiddenPath('api/health')

    // Requests — hidden path filtered
    const reqRes = await serveAnalyticsRoute('api/analytics/requests', new Request('http://localhost/api/analytics/requests'), c, undefined)
    const reqBody = await reqRes.json()
    expect(reqBody.total).toBe(1)
    expect(reqBody.data[0].path).toBe('api/users')

    // Errors — hidden path filtered
    const errRes = await serveAnalyticsRoute('api/analytics/errors', new Request('http://localhost/api/analytics/errors'), c, undefined)
    const errBody = await errRes.json()
    expect(errBody.total).toBe(1)
    expect(errBody.data[0].procedure).toBe('api/users')

    await c.dispose()
  })
})

describe('query API', () => {
  it('paginates requests with cursor and limit', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999 })
    for (let i = 0; i < 10; i++) {
      c.recordDetailedRequest({ timestamp: Date.now() + i, path: `api/r${i}`, durationMs: 1, status: 200, input: null, spans: [] })
    }

    const req = new Request('http://localhost/api/analytics/requests?limit=3')
    const res = await serveAnalyticsRoute('api/analytics/requests', req, c, undefined)
    const body = await res.json()

    expect(body.total).toBe(10)
    expect(body.data).toHaveLength(3)
    expect(body.hasMore).toBe(true)
    expect(body.nextCursor).toBeTruthy()
    await c.dispose()
  })

  it('returns all entries with default limit', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999 })
    for (let i = 0; i < 5; i++) {
      c.recordDetailedRequest({ timestamp: Date.now() + i, path: `api/r${i}`, durationMs: 1, status: 200, input: null, spans: [] })
    }

    const req = new Request('http://localhost/api/analytics/requests')
    const res = await serveAnalyticsRoute('api/analytics/requests', req, c, undefined)
    const body = await res.json()

    expect(body.total).toBe(5)
    expect(body.data).toHaveLength(5)
    await c.dispose()
  })

  it('filters errors by status', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999 })
    for (let i = 0; i < 8; i++) {
      c.recordDetailedError({
        requestId: `req-${i}`,
        timestamp: Date.now() + i,
        procedure: `api/fail${i}`,
        error: 'err',
        code: 'ERR',
        status: i < 4 ? 400 : 500,
        stack: '',
        input: null,
        headers: {},
        durationMs: 1,
        spans: [],
      })
    }

    const req = new Request('http://localhost/api/analytics/errors?status=500')
    const res = await serveAnalyticsRoute('api/analytics/errors', req, c, undefined)
    const body = await res.json()

    expect(body.total).toBe(4)
    expect(body.data).toHaveLength(4)
    await c.dispose()
  })

  it('searches requests by text', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999 })
    c.recordDetailedRequest({ timestamp: Date.now(), path: 'api/users/list', durationMs: 1, status: 200, input: null, spans: [] })
    c.recordDetailedRequest({ timestamp: Date.now(), path: 'api/products/list', durationMs: 1, status: 200, input: null, spans: [] })

    const req = new Request('http://localhost/api/analytics/requests?search=users')
    const res = await serveAnalyticsRoute('api/analytics/requests', req, c, undefined)
    const body = await res.json()

    expect(body.total).toBe(1)
    expect(body.data[0].path).toBe('api/users/list')
    await c.dispose()
  })
})

describe('hidden paths API', () => {
  it('manages hidden paths via API', async () => {
    const c = new AnalyticsCollector({ flushInterval: 999_999 })

    // POST — add
    const addReq = new Request('http://localhost/api/analytics/hidden', {
      method: 'POST',
      body: JSON.stringify({ path: 'api/health' }),
      headers: { 'content-type': 'application/json' },
    })
    const addRes = await serveAnalyticsRoute('api/analytics/hidden', addReq, c, undefined)
    const paths = await addRes.json()
    expect(paths).toContain('api/health')

    // GET — list
    const getReq = new Request('http://localhost/api/analytics/hidden')
    const getRes = await serveAnalyticsRoute('api/analytics/hidden', getReq, c, undefined)
    const list = await getRes.json()
    expect(list).toContain('api/health')

    // DELETE — remove
    const delReq = new Request('http://localhost/api/analytics/hidden', {
      method: 'DELETE',
      body: JSON.stringify({ path: 'api/health' }),
      headers: { 'content-type': 'application/json' },
    })
    const delRes = await serveAnalyticsRoute('api/analytics/hidden', delReq, c, undefined)
    const afterDel = await delRes.json()
    expect(afterDel).not.toContain('api/health')

    await c.dispose()
  })
})
