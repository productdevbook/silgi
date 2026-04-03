/**
 * Analytics HTTP routing — dashboard, API endpoints, auth.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseCookieHeader } from 'cookie-es'

import { errorToMarkdown, requestToMarkdown } from './export.ts'
import { parseQueryParams, queryErrors, queryRequests, queryTasks } from './query.ts'

import type { AnalyticsCollector } from './collector.ts'

// ── Dashboard HTML ──────────────────────────────────

const __analytics_dirname = dirname(fileURLToPath(import.meta.url))

let _dashboardCache: string | undefined

export function analyticsHTML(): string {
  if (_dashboardCache) return _dashboardCache

  const candidates = [
    resolve(__analytics_dirname, '../../lib/dashboard/index.html'),
    resolve(__analytics_dirname, '../lib/dashboard/index.html'),
    resolve(__analytics_dirname, '../../../lib/dashboard/index.html'),
  ]

  for (const p of candidates) {
    try {
      _dashboardCache = readFileSync(p, 'utf-8')
      return _dashboardCache
    } catch {
      // try next
    }
  }

  return FALLBACK_HTML
}

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Silgi Analytics</title>
<style>body{font-family:monospace;background:#0a0a0a;color:#e4e4e7;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.msg{text-align:center}.msg h1{color:#edc462;margin-bottom:8px}.msg p{color:#71717a;font-size:14px}</style></head>
<body><div class="msg"><h1>silgi analytics</h1><p>Dashboard not built. Run <code>pnpm build:dashboard</code></p></div></body></html>`

// ── Auth ────────────────────────────────────────────

export function checkAnalyticsAuth(
  request: Request,
  auth: string | ((req: Request) => boolean | Promise<boolean>),
): boolean | Promise<boolean> {
  if (typeof auth === 'function') return auth(request)
  const cookie = request.headers.get('cookie')
  if (cookie) {
    const cookies = parseCookieHeader(cookie)
    if (cookies['silgi-auth'] === auth) return true
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${auth}`) return true
  return false
}

const analyticsLoginHTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Silgi Analytics</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0a0a;color:#e5e5e5}
.c{width:100%;max-width:360px;padding:0 24px}
.logo{display:flex;align-items:center;gap:8px;margin-bottom:20px}
.logo svg{width:20px;height:20px;color:#c2822a}
.logo span{font-size:14px;font-weight:600;letter-spacing:-.01em}
p{font-size:13px;color:#737373;margin-bottom:16px;line-height:1.5}
input{width:100%;height:40px;padding:0 12px;background:#171717;border:1px solid #262626;border-radius:6px;color:#e5e5e5;font-size:13px;outline:none}
input:focus{border-color:#c2822a}
input::placeholder{color:#525252}
button{width:100%;height:36px;margin-top:10px;background:#c2822a;color:#0a0a0a;border:none;border-radius:6px;font-size:13px;font-weight:500;cursor:pointer}
button:hover{background:#d4943b}
.err{color:#ef4444;font-size:12px;margin-top:8px;display:none}
</style>
</head>
<body>
<div class="c">
<div class="logo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg><span>Silgi Analytics</span></div>
<p>Enter your access token to view the dashboard.</p>
<form id="f"><input id="t" type="password" placeholder="Access token" autofocus><div class="err" id="e">Invalid token</div><button type="submit">Authenticate</button></form>
</div>
<script>
document.getElementById('f').onsubmit=function(e){
e.preventDefault();
var t=document.getElementById('t').value.trim();
if(!t)return;
document.cookie='silgi-auth='+encodeURIComponent(t)+';path=/api/analytics;samesite=strict';
fetch('/api/analytics/stats',{headers:{'cookie':'silgi-auth='+encodeURIComponent(t)}}).then(function(){
location.reload();
}).catch(function(){location.reload()});
};
</script>
</body>
</html>`

/** Return auth-failure response for analytics routes. */
export function analyticsAuthResponse(pathname: string): Response {
  const jsonHeaders = { 'content-type': 'application/json' }
  if (pathname !== 'api/analytics' && pathname !== 'api/analytics/') {
    return new Response(JSON.stringify({ code: 'UNAUTHORIZED', status: 401, message: 'Invalid token' }), {
      status: 401,
      headers: jsonHeaders,
    })
  }
  return new Response(analyticsLoginHTML, { status: 401, headers: { 'content-type': 'text/html' } })
}

// ── Route Detail Helpers ────────────────────────────

function parseAnalyticsDetailPath(
  pathname: string,
  prefix: 'api/analytics/requests/' | 'api/analytics/errors/',
): { id: number | null; rawId: string } | null {
  if (!pathname.startsWith(prefix)) return null
  const rawId = pathname.slice(prefix.length)
  if (!rawId || rawId.includes('/')) return null
  const id = Number(rawId)
  return { id: Number.isFinite(id) ? id : null, rawId: decodeURIComponent(rawId) }
}

function jsonResponse(data: unknown, headers: HeadersInit): Response {
  return new Response(JSON.stringify(data), { headers })
}

// ── Main Router ─────────────────────────────────────

/** Serve analytics dashboard and API routes. */
export async function serveAnalyticsRoute(
  pathname: string,
  request: Request,
  collector: AnalyticsCollector,
  dashboardHtml: string | undefined,
): Promise<Response> {
  const jsonCacheHeaders = { 'content-type': 'application/json', 'cache-control': 'no-cache' }
  const mdHeaders = { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' }
  const url = new URL(request.url)

  if (pathname === 'api/analytics' || pathname === 'api/analytics/') {
    return new Response(dashboardHtml, { headers: { 'content-type': 'text/html' } })
  }
  if (pathname === 'api/analytics/stats') {
    return jsonResponse(collector.toJSON(), jsonCacheHeaders)
  }
  if (pathname === 'api/analytics/hidden') {
    if (request.method === 'GET') {
      return jsonResponse(collector.getHiddenPaths(), jsonCacheHeaders)
    }
    if (request.method === 'POST') {
      const body = (await request.json()) as { path?: string }
      if (typeof body.path !== 'string')
        return new Response('{"error":"path required"}', { status: 400, headers: jsonCacheHeaders })
      collector.addHiddenPath(body.path)
      return jsonResponse(collector.getHiddenPaths(), jsonCacheHeaders)
    }
    if (request.method === 'DELETE') {
      const body = (await request.json()) as { path?: string }
      if (typeof body.path !== 'string')
        return new Response('{"error":"path required"}', { status: 400, headers: jsonCacheHeaders })
      collector.removeHiddenPath(body.path)
      return jsonResponse(collector.getHiddenPaths(), jsonCacheHeaders)
    }
  }
  if (pathname === 'api/analytics/errors') {
    const errors = (await collector.getErrors()).filter((e) => !collector.isHidden(e.procedure))
    const params = parseQueryParams(url.searchParams)
    return jsonResponse(queryErrors(errors, params), jsonCacheHeaders)
  }
  if (pathname === 'api/analytics/requests') {
    const requests = (await collector.getRequests()).filter((r) => !collector.isHidden(r.path))
    const params = parseQueryParams(url.searchParams)
    return jsonResponse(queryRequests(requests, params), jsonCacheHeaders)
  }
  if (pathname === 'api/analytics/tasks') {
    const tasks = await collector.getTaskExecutions()
    const params = parseQueryParams(url.searchParams)
    return jsonResponse(queryTasks(tasks, params), jsonCacheHeaders)
  }
  if (pathname === 'api/analytics/scheduled') {
    const { getScheduledTasks } = await import('../../core/task.ts')
    return jsonResponse(getScheduledTasks(), jsonCacheHeaders)
  }
  // SSE stream
  if (pathname === 'api/analytics/stream') {
    const stream = collector.sseHub.createStream()
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  }
  // Time-series
  if (pathname === 'api/analytics/timeseries') {
    const range = (url.searchParams.get('range') as '1h' | '6h' | '24h' | '7d' | '30d') || '1h'
    return jsonResponse(collector.timeseries.query(range), jsonCacheHeaders)
  }
  // Alerts
  if (pathname === 'api/analytics/alerts') {
    return jsonResponse(
      {
        history: collector.alertEngine?.getHistory() ?? [],
        states: collector.alertEngine?.getStates() ?? {},
      },
      jsonCacheHeaders,
    )
  }
  // Cost
  if (pathname === 'api/analytics/cost') {
    return jsonResponse(collector.costTracker.getSummary(), jsonCacheHeaders)
  }
  // Trace correlation — find all requests sharing a trace ID
  if (pathname.startsWith('api/analytics/traces/')) {
    const traceId = decodeURIComponent(pathname.slice('api/analytics/traces/'.length))
    if (traceId) {
      const requests = await collector.getRequests()
      const related = requests.filter((r) => r.traceId === traceId)
      return jsonResponse(related, jsonCacheHeaders)
    }
  }
  if (pathname.startsWith('api/analytics/requests/') && pathname.endsWith('/md')) {
    const rawId = pathname.slice('api/analytics/requests/'.length, -'/md'.length)
    const parsedId = Number(rawId)
    const requestId = decodeURIComponent(rawId)
    const requests = await collector.getRequests()
    const entry = requests.find((r) => r.id === parsedId || r.requestId === requestId)
    if (entry) return new Response(requestToMarkdown(entry), { headers: mdHeaders })
    return new Response('not found', { status: 404 })
  }
  const requestDetail = parseAnalyticsDetailPath(pathname, 'api/analytics/requests/')
  if (requestDetail) {
    const requests = await collector.getRequests()
    const entry = requests.find((r) => r.id === requestDetail.id || r.requestId === requestDetail.rawId)
    return entry ? jsonResponse(entry, jsonCacheHeaders) : new Response('not found', { status: 404 })
  }
  if (pathname.startsWith('api/analytics/errors/') && pathname.endsWith('/md')) {
    const rawId = pathname.slice('api/analytics/errors/'.length, -'/md'.length)
    const id = Number(rawId)
    const errors = await collector.getErrors()
    const entry = errors.find((e) => e.id === id)
    if (entry) return new Response(errorToMarkdown(entry), { headers: mdHeaders })
    return new Response('not found', { status: 404 })
  }
  const errorDetail = parseAnalyticsDetailPath(pathname, 'api/analytics/errors/')
  if (errorDetail) {
    const errors = await collector.getErrors()
    const entry = errors.find((e) => e.id === errorDetail.id)
    return entry ? jsonResponse(entry, jsonCacheHeaders) : new Response('not found', { status: 404 })
  }
  if (pathname === 'api/analytics/errors/md') {
    const errors = await collector.getErrors()
    const md =
      errors.length === 0
        ? 'No errors.\n'
        : `# Errors (${errors.length})\n\n` + errors.map((e) => errorToMarkdown(e)).join('\n\n---\n\n')
    return new Response(md, { headers: mdHeaders })
  }
  return new Response(JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Analytics route not found' }), {
    status: 404,
    headers: jsonCacheHeaders,
  })
}
