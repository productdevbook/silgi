import { createContext, releaseContext } from '../compile.ts'
import { compileRouter } from '../compile.ts'
import {
  AnalyticsCollector,
  RequestAccumulator,
  RequestTrace,
  analyticsHTML,
  requestToMarkdown,
  errorToMarkdown,
} from '../plugins/analytics.ts'
import { generateOpenAPI, scalarHTML } from '../scalar.ts'

import { SilgiError, toSilgiError } from './error.ts'
import { routerCache } from './router-utils.ts'
import { ValidationError } from './schema.ts'
import { iteratorToEventStream } from './sse.ts'
import { stringifyJSON } from './utils.ts'

import type { CompiledRoute, CompiledRouterFn } from '../compile.ts'
import type { AnalyticsOptions } from '../plugins/analytics.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { Hookable } from 'hookable'

// Lazy-loaded codecs — resolved on first non-JSON request
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

// ── Response Encoding Helper ────────────────────────

export type ResponseFormat = 'json' | 'msgpack' | 'devalue'

export async function encodeResponse(
  data: unknown,
  status: number,
  format: ResponseFormat,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  switch (format) {
    case 'msgpack': {
      _msgpack ??= await import('../codec/msgpack.ts')
      return new Response(_msgpack.encode(data), {
        status,
        headers: { 'content-type': _msgpack.MSGPACK_CONTENT_TYPE, ...extraHeaders },
      })
    }
    case 'devalue': {
      _devalue ??= await import('../codec/devalue.ts')
      return new Response(_devalue.encode(data), {
        status,
        headers: { 'content-type': _devalue.DEVALUE_CONTENT_TYPE, ...extraHeaders },
      })
    }
    default:
      return new Response(stringifyJSON(data), {
        status,
        headers: { 'content-type': 'application/json', ...extraHeaders },
      })
  }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function checkAnalyticsAuth(
  request: Request,
  auth: string | ((req: Request) => boolean | Promise<boolean>),
): boolean | Promise<boolean> {
  if (typeof auth === 'function') return auth(request)
  // Token auth: check cookie or Authorization header only (no URL query for security)
  const cookie = request.headers.get('cookie')
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)silgi-auth=([^;]*)/)
    if (match && decodeURIComponent(match[1]!) === auth) return true
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${auth}`) return true
  return false
}

// ── Response Format Detection ───────────────────────

function detectResponseFormat(request: Request): ResponseFormat {
  const accept = request.headers.get('accept')
  if (!accept) return 'json'
  if (accept.includes('msgpack')) return 'msgpack'
  if (accept.includes('x-devalue')) return 'devalue'
  return 'json'
}

// ── Shared Response Builder ─────────────────────────

function makeResponse(
  output: unknown,
  route: CompiledRoute,
  format: ResponseFormat,
  releaseCtx?: Record<string, unknown>,
): Response | Promise<Response> {
  if (output instanceof Response) {
    releaseCtx && releaseContext(releaseCtx)
    return output
  }
  if (output instanceof ReadableStream) {
    // Don't release context — stream may still reference it via closures
    // Context will be GC'd when stream is done
    return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
  }
  if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
    // SSE/subscription — don't release context until stream closes
    const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    })
  }

  // Regular JSON/codec response — safe to release context now
  releaseCtx && releaseContext(releaseCtx)

  const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined

  if (format !== 'json') {
    return encodeResponse(output, 200, format, cacheHeaders)
  }

  return new Response(JSON.stringify(output), {
    headers: cacheHeaders
      ? { 'content-type': 'application/json', ...cacheHeaders }
      : { 'content-type': 'application/json' },
  })
}

// ── Shared Error Handler ────────────────────────────

function makeErrorResponse(error: unknown, format: ResponseFormat): Response | Promise<Response> {
  if (error instanceof ValidationError) {
    const body = { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
    return encodeResponse(body, 400, format)
  }
  if (error instanceof SyntaxError) {
    const body = { code: 'BAD_REQUEST', status: 400, message: 'Invalid JSON body' }
    return encodeResponse(body, 400, format)
  }
  const e = error instanceof SilgiError ? error : toSilgiError(error)
  return encodeResponse(e.toJSON(), e.status, format)
}

// ── Input Parsing ───────────────────────────────────

const isBun = typeof globalThis.Bun !== 'undefined'

async function parseInput(request: Request, url: string, qMark: number): Promise<unknown> {
  if (request.method === 'GET' || !request.body) {
    if (qMark !== -1) {
      const searchStr = url.slice(qMark + 1)
      const dataIdx = searchStr.indexOf('data=')
      if (dataIdx !== -1) {
        const valueStart = dataIdx + 5
        const valueEnd = searchStr.indexOf('&', valueStart)
        const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
        return JSON.parse(decodeURIComponent(encoded))
      }
    }
    return undefined
  }

  const ct = request.headers.get('content-type')

  // Binary codecs
  if (ct) {
    if (ct.includes('msgpack')) {
      _msgpack ??= await import('../codec/msgpack.ts')
      const buf = new Uint8Array(await request.arrayBuffer())
      return buf.length > 0 ? _msgpack.decode(buf) : undefined
    }
    if (ct.includes('x-devalue')) {
      _devalue ??= await import('../codec/devalue.ts')
      const text = await request.text()
      return text ? _devalue.decode(text) : undefined
    }
  }

  // JSON body
  if (isBun) {
    try {
      return await request.json()
    } catch {
      return undefined
    }
  }
  const text = await request.text()
  return text ? JSON.parse(text) : undefined
}

// ── Fetch Handler ───────────────────────────────────

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
document.cookie='silgi-auth='+encodeURIComponent(t)+';path=/analytics;samesite=strict';
fetch('/analytics/_api/stats',{headers:{'cookie':'silgi-auth='+encodeURIComponent(t)}}).then(function(){
location.reload();
}).catch(function(){location.reload()});
};
</script>
</body>
</html>`

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
  handlerOptions?: { scalar?: boolean | ScalarOptions; analytics?: boolean | AnalyticsOptions },
): (request: Request) => Response | Promise<Response> {
  // Compile router
  let compiledRouter = routerCache.get(routerDef) as CompiledRouterFn | undefined
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  // Pre-allocated constants
  const jsonHeaders = { 'content-type': 'application/json' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  // Scalar API docs
  const scalarEnabled = !!handlerOptions?.scalar
  let specJson: string | undefined
  let specHtml: string | undefined
  if (scalarEnabled) {
    const scalarOpts = typeof handlerOptions!.scalar === 'object' ? handlerOptions!.scalar : {}
    specJson = JSON.stringify(generateOpenAPI(routerDef, scalarOpts))
    specHtml = scalarHTML('/openapi.json', scalarOpts)
  }

  // Analytics
  const analyticsEnabled = !!handlerOptions?.analytics
  let collector: AnalyticsCollector | undefined
  let analyticsDashboardHtml: string | undefined
  let analyticsAuth: string | ((req: Request) => boolean | Promise<boolean>) | undefined
  if (analyticsEnabled) {
    const analyticsOpts = typeof handlerOptions!.analytics === 'object' ? handlerOptions!.analytics : {}
    collector = new AnalyticsCollector(analyticsOpts)
    analyticsDashboardHtml = analyticsHTML()
    analyticsAuth = analyticsOpts.auth
  }

  // Hook helpers — use hookable's API directly, no monkey-patching
  function callHook(name: keyof SilgiHooks, event: any): void {
    if (!hooks) return
    try {
      const result = hooks.callHook(name, event)
      if (result instanceof Promise) result.catch(() => {})
    } catch {}
  }

  // Analytics serving
  function analyticsAuthResponse(pathname: string): Response {
    if (pathname.includes('_api/')) {
      return new Response(JSON.stringify({ code: 'UNAUTHORIZED', status: 401, message: 'Invalid token' }), {
        status: 401,
        headers: jsonHeaders,
      })
    }
    return new Response(analyticsLoginHTML, { status: 401, headers: { 'content-type': 'text/html' } })
  }

  function serveAnalytics(pathname: string, col: AnalyticsCollector): Response {
    if (pathname === 'analytics/_api/stats') {
      return new Response(JSON.stringify(col.toJSON()), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      })
    }
    if (pathname === 'analytics/_api/errors') {
      return new Response(JSON.stringify(col.getErrors()), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      })
    }
    if (pathname === 'analytics/_api/requests') {
      return new Response(JSON.stringify(col.getRequests()), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
      })
    }
    if (pathname.startsWith('analytics/_api/requests/') && pathname.endsWith('/md')) {
      const id = Number(pathname.slice('analytics/_api/requests/'.length, -'/md'.length))
      const entry = col.getRequests().find((r) => r.id === id)
      if (entry) {
        return new Response(requestToMarkdown(entry), {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    if (pathname.startsWith('analytics/_api/errors/') && pathname.endsWith('/md')) {
      const id = Number(pathname.slice('analytics/_api/errors/'.length, -'/md'.length))
      const entry = col.getErrors().find((e) => e.id === id)
      if (entry) {
        return new Response(errorToMarkdown(entry), {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    if (pathname === 'analytics/_api/errors/md') {
      const errors = col.getErrors()
      const md =
        errors.length === 0
          ? 'No errors.\n'
          : `# Errors (${errors.length})\n\n` + errors.map((e) => errorToMarkdown(e)).join('\n\n---\n\n')
      return new Response(md, {
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' },
      })
    }
    return new Response(analyticsDashboardHtml, { headers: { 'content-type': 'text/html' } })
  }

  // ── Unified Request Handler ───────────────────────
  // Single code path for all requests — clean, maintainable, correct.

  async function handleRequest(request: Request): Promise<Response> {
    // URL parse
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)
    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    // Analytics accumulator
    let accumulator: RequestAccumulator | undefined
    if (collector) {
      accumulator = new RequestAccumulator(request, collector)
    }

    // Scalar routes
    if (scalarEnabled) {
      if (pathname === 'openapi.json') {
        return new Response(specJson, { headers: { 'content-type': 'application/json' } })
      }
      if (pathname === 'reference') {
        return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
      }
    }

    // Analytics routes
    if (analyticsEnabled && collector && pathname.startsWith('analytics')) {
      if (analyticsAuth) {
        const authResult = checkAnalyticsAuth(request, analyticsAuth)
        const ok = authResult instanceof Promise ? await authResult : authResult
        if (!ok) return analyticsAuthResponse(pathname)
      }
      return serveAnalytics(pathname, collector)
    }

    // Route lookup
    const match = compiledRouter!(request.method, fullPath)
    if (!match) return new Response(notFoundBody, { status: 404, headers: jsonHeaders })

    const route = match.data
    const reqMethod = request.method

    // Method enforcement
    if (route.method !== '*' && reqMethod !== route.method && reqMethod !== 'OPTIONS') {
      if (!(reqMethod === 'GET' && route.method === 'POST')) {
        return new Response(
          JSON.stringify({ code: 'METHOD_NOT_ALLOWED', status: 405, message: `Method ${reqMethod} not allowed` }),
          { status: 405, headers: { ...jsonHeaders, allow: route.method } },
        )
      }
    }

    const format = detectResponseFormat(request)
    const ctx = createContext()
    let reqTrace: RequestTrace | undefined
    let rawInput: unknown
    let t0 = 0

    try {
      // Context factory — always called
      const baseCtxResult = contextFactory(request)
      const baseCtx = baseCtxResult instanceof Promise ? await baseCtxResult : baseCtxResult
      const keys = Object.keys(baseCtx)
      for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]

      if (match.params) ctx.params = match.params

      // Analytics trace
      if (collector) {
        reqTrace = new RequestTrace()
        ctx.__analyticsTrace = reqTrace
        ctx.trace = reqTrace.trace.bind(reqTrace)
      }

      // Parse input (skip for passthrough routes)
      if (!route.passthrough) {
        rawInput = await parseInput(request, url, qMark)
      }

      callHook('request', { path: pathname, input: rawInput })

      // Execute pipeline
      t0 = collector ? performance.now() : 0
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      // Record analytics
      const durationMs = collector ? round(performance.now() - t0) : 0
      callHook('response', { path: pathname, output, durationMs })

      if (collector) {
        collector.record(pathname, durationMs)
        if (accumulator) {
          accumulator.addProcedure({
            procedure: pathname,
            durationMs,
            status: 200,
            input: rawInput,
            output: output instanceof ReadableStream || (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) ? null : output,
            spans: reqTrace?.spans ?? [],
          })
        }
      }

      // Build response — for streaming, context is NOT released (stream may hold refs)
      const isStreaming =
        output instanceof ReadableStream ||
        (output && typeof output === 'object' && Symbol.asyncIterator in (output as object))

      const response = makeResponse(output, route, format, isStreaming ? undefined : ctx)
      return response instanceof Promise ? await response : response
    } catch (error) {
      releaseContext(ctx)
      callHook('error', { path: pathname, error })

      // Record error analytics
      if (collector) {
        const durationMs = t0 ? round(performance.now() - t0) : 0
        const errorMsg = error instanceof Error ? error.message : String(error)
        const isValidation = error instanceof ValidationError
        const silgiErr = isValidation ? null : error instanceof SilgiError ? error : toSilgiError(error)
        const errStatus = isValidation ? 400 : (silgiErr?.status ?? 500)

        collector.recordError(pathname, durationMs, errorMsg)
        collector.recordDetailedError({
          requestId: accumulator?.requestId ?? '',
          timestamp: Date.now(),
          procedure: pathname,
          error: errorMsg,
          code: isValidation ? 'BAD_REQUEST' : (silgiErr?.code ?? 'INTERNAL_SERVER_ERROR'),
          status: errStatus,
          // Truncate for security — don't store unbounded attacker input
          stack: error instanceof Error ? (error.stack ?? '').slice(0, 2048) : '',
          input: typeof rawInput === 'string' ? rawInput.slice(0, 4096) : rawInput,
          headers: sanitizeHeaders(request.headers),
          durationMs,
          spans: reqTrace?.spans ?? [],
        })

        if (accumulator) {
          accumulator.addProcedure({
            procedure: pathname,
            durationMs,
            status: errStatus,
            input: rawInput,
            output: null,
            spans: reqTrace?.spans ?? [],
            error: errorMsg,
          })
        }
      }

      const errorResponse = makeErrorResponse(error, format)
      return errorResponse instanceof Promise ? await errorResponse : errorResponse
    }
  }

  // Wrap with analytics headers if collector is active
  if (!collector) return handleRequest

  return async (request: Request): Promise<Response> => {
    const acc = new RequestAccumulator(request, collector!)
    const response = await handleRequest(request)

    const headers = new Headers(response.headers)
    headers.set('x-request-id', acc.requestId)
    const cookie = acc.getSessionCookie()
    if (cookie) headers.append('set-cookie', cookie)
    const injected = new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    acc.flushWithResponse(injected)
    return injected
  }
}

// ── Sanitize headers for analytics storage ──────────

function sanitizeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {}
  const sensitiveKeys = new Set(['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'proxy-authorization'])
  headers.forEach((value, key) => {
    result[key] = sensitiveKeys.has(key.toLowerCase()) ? '[REDACTED]' : value
  })
  return result
}
