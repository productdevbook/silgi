import { ContextPool } from '../compile.ts'
import { compileRouter } from '../compile.ts'
import { AnalyticsCollector, RequestAccumulator, RequestTrace, analyticsHTML, requestToMarkdown, errorToMarkdown } from '../plugins/analytics.ts'
import { generateOpenAPI, scalarHTML } from '../scalar.ts'

import { SilgiError, toSilgiError } from './error.ts'
import { routerCache } from './router-utils.ts'
import { ValidationError } from './schema.ts'
import { iteratorToEventStream } from './sse.ts'
import { stringifyJSON } from './utils.ts'

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
  jsonStringify?: (v: unknown) => string,
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
      return new Response(jsonStringify ? jsonStringify(data) : stringifyJSON(data), {
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
  rawUrl: string,
  auth: string | ((req: Request) => boolean | Promise<boolean>),
): boolean | Promise<boolean> {
  if (typeof auth === 'function') return auth(request)
  // Token auth: check cookie, Authorization header, or ?token= query param
  const cookie = request.headers.get('cookie')
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)silgi-auth=([^;]*)/)
    if (match && decodeURIComponent(match[1]!) === auth) return true
  }
  const authHeader = request.headers.get('authorization')
  if (authHeader === `Bearer ${auth}`) return true
  const tokenIdx = rawUrl.indexOf('token=')
  if (tokenIdx !== -1) {
    const valueStart = tokenIdx + 6
    const valueEnd = rawUrl.indexOf('&', valueStart)
    const token = valueEnd === -1 ? rawUrl.slice(valueStart) : rawUrl.slice(valueStart, valueEnd)
    if (decodeURIComponent(token) === auth) return true
  }
  return false
}

// ── Fetch Handler ───────────────────────────────────

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
  handlerOptions?: { scalar?: boolean | ScalarOptions; analytics?: boolean | AnalyticsOptions },
): (request: Request) => Response | Promise<Response> {
  // Compile router tree into JIT-compiled radix router
  let compiledRouter = routerCache.get(routerDef)
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  // Context pool — zero allocation per request
  const ctxPool = new ContextPool()

  // Pre-allocate response headers and reusable context (reused across requests)
  const jsonHeaders = { 'content-type': 'application/json' }
  const emptyCtx = Object.create(null)
  const sseHeaders = { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }
  const notFoundBody = JSON.stringify({ code: 'NOT_FOUND', status: 404, message: 'Procedure not found' })

  // Scalar API docs (lazy init)
  const scalarEnabled = !!handlerOptions?.scalar
  let specJson: string | undefined
  let specHtml: string | undefined
  if (scalarEnabled) {
    const scalarOpts = typeof handlerOptions!.scalar === 'object' ? handlerOptions!.scalar : {}
    specJson = JSON.stringify(generateOpenAPI(routerDef, scalarOpts))
    specHtml = scalarHTML('/openapi.json', scalarOpts)
  }

  // Analytics (sync init)
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

  // Pre-check: does the hooks instance actually have registered listeners?
  // Hookable always creates a non-null object, but we only need callHook when
  // at least one hook is registered. This enables minimalHandler activation.
  const hasHooks = !!(hooks as any)?._hooks && Object.keys((hooks as any)._hooks).some((k) => (hooks as any)._hooks[k]?.length > 0)

  // Runtime detection: Bun's request.json() is native C++ — faster than text() + JSON.parse()
  const isBun = typeof globalThis.Bun !== 'undefined'


  // Pre-check: is context factory sync? Also detect empty context for zero-copy path.
  let ctxFactoryIsSync = false
  let ctxFactoryIsEmpty = false
  try {
    const testResult = contextFactory(new Request('http://localhost'))
    if (testResult instanceof Promise) {
      testResult.then((r) => {
        ctxFactoryIsEmpty = Object.keys(r).length === 0
      })
    } else {
      ctxFactoryIsSync = true
      ctxFactoryIsEmpty = Object.keys(testResult).length === 0
    }
  } catch {}

  function analyticsAuthResponse(pathname: string): Response {
    // API endpoints get JSON 401, browser navigation gets HTML login
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
    // Markdown export: /analytics/_api/requests/:id/md
    if (pathname.startsWith('analytics/_api/requests/') && pathname.endsWith('/md')) {
      const id = Number(pathname.slice('analytics/_api/requests/'.length, -'/md'.length))
      const entry = col.getRequests().find(r => r.id === id)
      if (entry) {
        return new Response(requestToMarkdown(entry), {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    // Markdown export: /analytics/_api/errors/:id/md
    if (pathname.startsWith('analytics/_api/errors/') && pathname.endsWith('/md')) {
      const id = Number(pathname.slice('analytics/_api/errors/'.length, -'/md'.length))
      const entry = col.getErrors().find(e => e.id === id)
      if (entry) {
        return new Response(errorToMarkdown(entry), {
          headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' },
        })
      }
      return new Response('not found', { status: 404 })
    }
    // All errors as single markdown
    if (pathname === 'analytics/_api/errors/md') {
      const errors = col.getErrors()
      const md = errors.length === 0
        ? 'No errors.\n'
        : `# Errors (${errors.length})\n\n` + errors.map(e => errorToMarkdown(e)).join('\n\n---\n\n')
      return new Response(md, {
        headers: { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-cache' },
      })
    }
    return new Response(analyticsDashboardHtml, { headers: { 'content-type': 'text/html' } })
  }

  function handleRequest(request: Request): Response | Promise<Response> {
    // FAST pathname extraction — 40x faster than new URL()
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    // Keep leading '/' for router, use +1 slice for readable path comparisons
    const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)

    const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''

    // HTTP-level request accumulator — only when analytics collector exists
    let accumulator: RequestAccumulator | undefined
    if (collector) {
      accumulator = (request as any).__acc ?? new RequestAccumulator(request, collector)
    }

    // Scalar: /openapi.json and /reference
    if (scalarEnabled) {
      if (pathname === 'openapi.json') {
        return new Response(specJson, { headers: { 'content-type': 'application/json' } })
      }
      if (pathname === 'reference') {
        return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
      }
    }

    // Analytics: /analytics/* — dashboard SPA + JSON API
    if (analyticsEnabled && collector) {
      if (pathname.startsWith('analytics')) {
        if (analyticsAuth) {
          const authResult = checkAnalyticsAuth(request, url, analyticsAuth)
          if (authResult instanceof Promise) {
            return authResult.then((ok) => {
              if (!ok) return analyticsAuthResponse(pathname)
              return serveAnalytics(pathname, collector!)
            })
          }
          if (!authResult) return analyticsAuthResponse(pathname)
        }
        return serveAnalytics(pathname, collector)
      }
    }

    // Compiled radix router lookup — fullPath already has leading '/'
    const match = compiledRouter!(request.method, fullPath)
    if (!match) {
      return new Response(notFoundBody, { status: 404, headers: jsonHeaders })
    }
    const route = match.data

    // ── Fast sync path: GET, sync context factory, no body ──
    // Avoids async/await overhead entirely for simple queries
    const method = request.method
    if (ctxFactoryIsSync && (method === 'GET' || !request.body) && !route.passthrough) {
      // Ultra-fast: skip pool when context is empty, no params, no analytics
      const usePool = !ctxFactoryIsEmpty || match.params || collector
      const ctx = usePool ? ctxPool.borrow() : (emptyCtx as Record<string, unknown>)
      let t0 = 0
      let reqTrace: RequestTrace | undefined
      let rawInput: unknown
      try {
        // Skip context factory + keys iteration when factory returns empty object
        if (!ctxFactoryIsEmpty) {
          const baseCtx = contextFactory(request) as Record<string, unknown>
          const keys = Object.keys(baseCtx)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
        }
        if (match.params) ctx.params = match.params

        // Inject trace helper when analytics is enabled
        if (collector) {
          reqTrace = new RequestTrace()
          ctx.__analyticsTrace = reqTrace
          ctx.trace = reqTrace.trace.bind(reqTrace)
        }
        if (method === 'GET' && qMark !== -1) {
          const searchStr = url.slice(qMark + 1)
          const dataIdx = searchStr.indexOf('data=')
          if (dataIdx !== -1) {
            const valueStart = dataIdx + 5
            const valueEnd = searchStr.indexOf('&', valueStart)
            const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
            rawInput = JSON.parse(decodeURIComponent(encoded))
          }
        }

        if (hasHooks) hooks!.callHook('request', { path: pathname, input: rawInput })

        t0 = collector ? performance.now() : 0
        const pipelineResult = route.handler(ctx, rawInput, request.signal)

        // Sync pipeline result — fully synchronous response
        if (!(pipelineResult instanceof Promise)) {
          const output = pipelineResult
          if (hasHooks || collector) {
            const durationMs = collector ? round(performance.now() - t0) : 0
            if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs })
            if (collector) {
              collector.record(pathname, durationMs)
              if (accumulator) {
                accumulator.addProcedure({ procedure: pathname, durationMs, status: 200, input: rawInput, output, spans: reqTrace?.spans ?? [] })

              }
            }
          }

          if (output instanceof Response) return output
          if (output instanceof ReadableStream) {
            if (collector && accumulator) {
              accumulator.addProcedure({ procedure: pathname, durationMs: collector ? round(performance.now() - t0) : 0, status: 200, input: rawInput, output: null, spans: reqTrace?.spans ?? [] })

            }
            return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
          }
          if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
            if (collector && accumulator) {
              accumulator.addProcedure({ procedure: pathname, durationMs: collector ? round(performance.now() - t0) : 0, status: 200, input: rawInput, output: null, spans: reqTrace?.spans ?? [] })

            }
            return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), {
              headers: sseHeaders,
            })
          }

          // Content negotiation — check Accept header for non-JSON formats
          const accept = request.headers.get('accept')
          if (accept && (accept.includes('msgpack') || accept.includes('x-devalue'))) {
            const fmt: ResponseFormat = accept.includes('msgpack') ? 'msgpack' : 'devalue'
            const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
            return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
          }

          // JSON fast path — skip content negotiation for most requests
          const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
          return new Response(route.stringify(output), {
            headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
          })
        }

        // Async pipeline result but sync context — partial async
        return pipelineResult
          .then((output) => {
            const durationMs = collector ? round(performance.now() - t0) : 0
            if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs })
            if (collector) {
              collector.record(pathname, durationMs)
              if (accumulator) {
                accumulator.addProcedure({ procedure: pathname, durationMs, status: 200, input: rawInput, output, spans: reqTrace?.spans ?? [] })

              }
            }
            if (output instanceof Response) return output
            if (output instanceof ReadableStream)
              return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
            if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
              return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), {
                headers: sseHeaders,
              })
            }
            const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
            return new Response(route.stringify(output), {
              headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
            })
          })
          .catch((error) => handleError(error, pathname, request, rawInput, reqTrace, t0, accumulator))
          .finally(() => {
            if (usePool) ctxPool.release(ctx)
          })
      } catch (error) {
        if (usePool) ctxPool.release(ctx)
        return handleError(error, pathname, request, rawInput, reqTrace, t0, accumulator)
      }
    }

    // ── Fast POST path: sync context, JSON body, no analytics ──
    // Uses .then() chain instead of async function to avoid Promise wrapper overhead
    // Skip when content-type is non-JSON (msgpack/devalue codecs need handleAsync)
    // Check if request uses JSON body and doesn't need codec response
    const ct = request.headers.get('content-type')
    const isJsonBody = !ct || ct.startsWith('application/json')
    const accept = request.headers.get('accept')
    const needsCodecResponse = accept && (accept.includes('msgpack') || accept.includes('x-devalue'))
    if (ctxFactoryIsSync && isJsonBody && !needsCodecResponse && !route.passthrough && !collector) {
      const ctx = ctxFactoryIsEmpty && !match.params ? (emptyCtx as Record<string, unknown>) : ctxPool.borrow()
      const needsRelease = ctx !== emptyCtx

      if (!ctxFactoryIsEmpty) {
        const baseCtx = contextFactory(request) as Record<string, unknown>
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }
      if (match.params) ctx.params = match.params

      // Body parse → pipeline → response — single .then() chain
      const bodyParse = isBun ? request.json() : request.text().then((t) => (t ? JSON.parse(t) : undefined))

      return bodyParse
        .then((rawInput: unknown) => {
          if (hasHooks) hooks!.callHook('request', { path: pathname, input: rawInput })

          const pipelineResult = route.handler(ctx, rawInput, request.signal)
          if (!(pipelineResult instanceof Promise)) {
            if (hasHooks) hooks!.callHook('response', { path: pathname, output: pipelineResult, durationMs: 0 })
            return _makeResponse(pipelineResult, route)
          }
          return pipelineResult.then((output) => {
            if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs: 0 })
            return _makeResponse(output, route)
          })
        })
        .catch((error: unknown) => handleError(error, pathname, request, undefined, undefined, 0, accumulator) as Response)
        .finally(() => {
          if (needsRelease) ctxPool.release(ctx)
        })
    }

    // ── Full async path: POST with body, async context factory, codecs, analytics ──
    return handleAsync(request, url, pathname, qMark, match, route, accumulator)
  }

  /** Shared response builder — avoids code duplication */
  function _makeResponse(output: unknown, route: import('../compile.ts').CompiledRoute): Response {
    if (output instanceof Response) return output
    if (output instanceof ReadableStream)
      return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
    if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object))
      return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: sseHeaders })
    const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
    return new Response(route.stringify(output), {
      headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
    })
  }

  async function handleAsync(
    request: Request,
    url: string,
    pathname: string,
    qMark: number,
    match: NonNullable<ReturnType<NonNullable<typeof compiledRouter>>>,
    route: import('../compile.ts').CompiledRoute,
    accumulator?: RequestAccumulator,
  ): Promise<Response> {
    // Skip ctxPool when context is empty, no params, no analytics
    const usePool = !ctxFactoryIsEmpty || match.params || collector
    const ctx = usePool ? ctxPool.borrow() : (emptyCtx as Record<string, unknown>)
    let reqTrace: RequestTrace | undefined
    let rawInput: unknown
    let t0 = 0

    try {
      // Context factory — skip await when sync, skip copy when empty
      if (!ctxFactoryIsEmpty) {
        const baseCtxResult = contextFactory(request)
        const baseCtx = baseCtxResult instanceof Promise ? await baseCtxResult : baseCtxResult
        const keys = Object.keys(baseCtx)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
      }
      if (match.params) ctx.params = match.params

      if (collector) {
        reqTrace = new RequestTrace()
        ctx.__analyticsTrace = reqTrace
        ctx.trace = reqTrace.trace.bind(reqTrace)
      }

      // Parse input body (skip for passthrough routes — they consume the body themselves)
      if (route.passthrough) {
        // No body parsing — external handler reads it directly
      } else if (request.method === 'GET') {
        if (qMark !== -1) {
          const searchStr = url.slice(qMark + 1)
          const dataIdx = searchStr.indexOf('data=')
          if (dataIdx !== -1) {
            const valueStart = dataIdx + 5
            const valueEnd = searchStr.indexOf('&', valueStart)
            const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
            rawInput = JSON.parse(decodeURIComponent(encoded))
          }
        }
      } else if (request.body) {
        const ct = request.headers.get('content-type')
        if (ct && ct.charCodeAt(12) !== 106) {
          // Not 'application/json' — check binary codecs (12th char: 'j' = 106)
          if (ct.includes('msgpack')) {
            _msgpack ??= await import('../codec/msgpack.ts')
            const buf = new Uint8Array(await request.arrayBuffer())
            rawInput = buf.length > 0 ? _msgpack.decode(buf) : undefined
          } else if (ct.includes('x-devalue')) {
            _devalue ??= await import('../codec/devalue.ts')
            const text = await request.text()
            rawInput = text ? _devalue.decode(text) : undefined
          } else if (isBun) {
            rawInput = await request.json()
          } else {
            const text = await request.text()
            rawInput = text ? JSON.parse(text) : undefined
          }
        } else if (isBun) {
          rawInput = await request.json()
        } else {
          const text = await request.text()
          rawInput = text ? JSON.parse(text) : undefined
        }
      }

      if (hasHooks) hooks!.callHook('request', { path: pathname, input: rawInput })

      t0 = collector ? performance.now() : 0
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      if (output instanceof Response) {
        if (hasHooks || collector) {
          const durationMs = collector ? round(performance.now() - t0) : 0
          if (hasHooks) hooks!.callHook('response', { path: pathname, output: null, durationMs })
          if (collector) {
            collector.record(pathname, durationMs)
            if (accumulator) {
              accumulator.addProcedure({ procedure: pathname, durationMs, status: output.status, input: rawInput ?? reqTrace?.procedureInput ?? null, output: reqTrace?.procedureOutput ?? null, spans: reqTrace?.spans ?? [] })
            }
          }
        }
        return output
      }
      if (output instanceof ReadableStream) {
        if (collector) {
          const durationMs = round(performance.now() - t0)
          collector.record(pathname, durationMs)
          if (accumulator) {
            accumulator.addProcedure({ procedure: pathname, durationMs, status: 200, input: rawInput, output: null, spans: reqTrace?.spans ?? [] })
          }
        }
        return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
      }
      if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
        if (collector) {
          const durationMs = round(performance.now() - t0)
          collector.record(pathname, durationMs)
          if (accumulator) {
            accumulator.addProcedure({ procedure: pathname, durationMs, status: 200, input: rawInput, output: null, spans: reqTrace?.spans ?? [] })
          }
        }
        return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: sseHeaders })
      }

      const durationMs = collector ? round(performance.now() - t0) : 0
      if (hasHooks) hooks!.callHook('response', { path: pathname, output, durationMs })
      if (collector) {
        collector.record(pathname, durationMs)
        if (accumulator) {
          accumulator.addProcedure({ procedure: pathname, durationMs, status: 200, input: rawInput, output, spans: reqTrace?.spans ?? [] })
        }
      }

      const accept = request.headers.get('accept')
      if (accept && (accept.includes('msgpack') || accept.includes('x-devalue'))) {
        const fmt: ResponseFormat = accept.includes('msgpack') ? 'msgpack' : 'devalue'
        const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
        return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
      }

      const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
      return new Response(route.stringify(output), {
        headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
      })
    } catch (error) {
      return handleError(error, pathname, request, rawInput, reqTrace, t0, accumulator) as Response
    } finally {
      if (usePool) ctxPool.release(ctx)
    }
  }

  function handleError(
    error: unknown,
    pathname: string,
    request: Request,
    rawInput: unknown,
    reqTrace: RequestTrace | undefined,
    t0: number,
    accumulator?: RequestAccumulator,
  ): Response | Promise<Response> {
    if (hasHooks) hooks!.callHook('error', { path: pathname, error })
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
        stack: error instanceof Error ? (error.stack ?? '') : '',
        input: rawInput,
        headers: Object.fromEntries(request.headers),
        durationMs,
        spans: reqTrace?.spans ?? [],
      })

      // Also record in HTTP request accumulator
      if (accumulator) {
        accumulator.addProcedure({ procedure: pathname, durationMs, status: errStatus, input: rawInput, output: null, spans: reqTrace?.spans ?? [], error: errorMsg })

      }
    }

    const accept = request.headers.get('accept')
    const fmt: ResponseFormat = accept?.includes('msgpack')
      ? 'msgpack'
      : accept?.includes('x-devalue')
        ? 'devalue'
        : 'json'
    if (error instanceof ValidationError) {
      const errBody = { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
      return encodeResponse(errBody, 400, fmt)
    }
    const e = error instanceof SilgiError ? error : toSilgiError(error)
    return encodeResponse(e.toJSON(), e.status, fmt)
  }

  // ── MINIMAL HANDLER: no scalar, no analytics, no hooks ──────────
  // When all optional features are disabled AND context factory is sync,
  // return a stripped handler that eliminates per-request branch checks.
  // Supports: JSON, msgpack, devalue codecs, streaming, SSE, passthrough,
  // cache-control headers, and proper error formatting.
  if (!collector && !scalarEnabled && !analyticsEnabled && !hasHooks && ctxFactoryIsSync) {
    return function minimalHandler(request: Request): Response | Promise<Response> {
      const url = request.url
      const pathStart = url.indexOf('/', url.indexOf('//') + 2)
      const qMark = url.indexOf('?', pathStart)
      const fullPath = qMark === -1 ? url.slice(pathStart) : url.slice(pathStart, qMark)

      const match = compiledRouter!(request.method, fullPath)
      if (!match) return new Response(notFoundBody, { status: 404, headers: jsonHeaders })

      const route = match.data

      // ── GET / no body — fully sync ──
      if (request.method === 'GET' || !request.body) {
        const ctx: Record<string, unknown> = ctxFactoryIsEmpty && !match.params
          ? (emptyCtx as Record<string, unknown>)
          : Object.create(null)

        if (!ctxFactoryIsEmpty) {
          const base = contextFactory(request) as Record<string, unknown>
          const keys = Object.keys(base)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = base[keys[i]!]
        }
        if (match.params) ctx.params = match.params

        try {
          let input: unknown
          if (qMark !== -1) {
            const s = url.slice(qMark + 1)
            const di = s.indexOf('data=')
            if (di !== -1) {
              const vs = di + 5
              const ve = s.indexOf('&', vs)
              input = JSON.parse(decodeURIComponent(ve === -1 ? s.slice(vs) : s.slice(vs, ve)))
            }
          }

          const result = route.handler(ctx, input, request.signal)
          if (!(result instanceof Promise)) return _minimalResponse(result, route, request)
          return result.then(
            (output) => _minimalResponse(output, route, request),
            (error) => _minimalError(error, request),
          )
        } catch (error) {
          return _minimalError(error, request)
        }
      }

      // Passthrough routes — fall to full handler (body must not be consumed)
      if (route.passthrough) {
        const pathname = fullPath.length > 1 ? fullPath.slice(1) : ''
        return handleAsync(request, url, pathname, qMark, match, route)
      }

      // ── POST — parse body with codec support ──
      const ctx: Record<string, unknown> = ctxFactoryIsEmpty && !match.params
        ? (emptyCtx as Record<string, unknown>)
        : Object.create(null)

      if (!ctxFactoryIsEmpty) {
        const base = contextFactory(request) as Record<string, unknown>
        const keys = Object.keys(base)
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = base[keys[i]!]
      }
      if (match.params) ctx.params = match.params

      // Body parsing with codec detection
      const ct = request.headers.get('content-type')
      let bodyPromise: Promise<unknown>
      if (ct && !ct.startsWith('application/json')) {
        if (ct.includes('msgpack')) {
          bodyPromise = (async () => {
            _msgpack ??= await import('../codec/msgpack.ts')
            const buf = new Uint8Array(await request.arrayBuffer())
            return buf.length > 0 ? _msgpack.decode(buf) : undefined
          })()
        } else if (ct.includes('x-devalue')) {
          bodyPromise = (async () => {
            _devalue ??= await import('../codec/devalue.ts')
            const text = await request.text()
            return text ? _devalue.decode(text) : undefined
          })()
        } else {
          bodyPromise = isBun ? request.json() : request.text().then((t) => (t ? JSON.parse(t) : undefined))
        }
      } else {
        bodyPromise = isBun ? request.json() : request.text().then((t) => (t ? JSON.parse(t) : undefined))
      }

      return bodyPromise
        .then((rawInput: unknown) => {
          const result = route.handler(ctx, rawInput, request.signal)
          if (!(result instanceof Promise)) return _minimalResponse(result, route, request)
          return result.then((output) => _minimalResponse(output, route, request))
        })
        .catch((error: unknown) => _minimalError(error, request))
    }
  }

  /** Response builder for minimalHandler — includes codec negotiation */
  function _minimalResponse(output: unknown, route: import('../compile.ts').CompiledRoute, request: Request): Response | Promise<Response> {
    if (output instanceof Response) return output
    if (output instanceof ReadableStream)
      return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
    if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object))
      return new Response(iteratorToEventStream(output as AsyncIterableIterator<unknown>), { headers: sseHeaders })

    // Content negotiation — check Accept header for codec response format
    const accept = request.headers.get('accept')
    if (accept && (accept.includes('msgpack') || accept.includes('x-devalue'))) {
      const fmt: ResponseFormat = accept.includes('msgpack') ? 'msgpack' : 'devalue'
      const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
      return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
    }

    const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
    return new Response(route.stringify(output), {
      headers: cacheHeaders ? { ...jsonHeaders, ...cacheHeaders } : jsonHeaders,
    })
  }

  /** Error handler for minimalHandler — codec-aware error formatting */
  function _minimalError(error: unknown, request: Request): Response | Promise<Response> {
    const accept = request.headers.get('accept')
    const fmt: ResponseFormat = accept?.includes('msgpack')
      ? 'msgpack'
      : accept?.includes('x-devalue')
        ? 'devalue'
        : 'json'
    if (error instanceof ValidationError) {
      const errBody = { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
      return encodeResponse(errBody, 400, fmt)
    }
    const e = error instanceof SilgiError ? error : toSilgiError(error)
    return encodeResponse(e.toJSON(), e.status, fmt)
  }

  if (!collector) return handleRequest

  // Wrap to inject x-request-id + session cookie headers
  return (request: Request): Response | Promise<Response> => {
    // Create accumulator BEFORE handleRequest so we own the reference
    const acc = new RequestAccumulator(request, collector!)
    // Store on request for handleRequest to find
    ;(request as any).__acc = acc

    const result = handleRequest(request)

    function injectHeaders(res: Response): Response {
      res.headers.set('x-request-id', acc.requestId)
      const cookie = acc.getSessionCookie()
      if (cookie) res.headers.append('set-cookie', cookie)
      // Flush AFTER response headers are finalized — captures actual response headers
      acc.flushWithResponse(res)
      return res
    }

    if (result instanceof Promise) return result.then(injectHeaders)
    return injectHeaders(result)
  }
}
