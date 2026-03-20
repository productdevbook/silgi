import {
  encode as devalueEncode,
  decode as devalueDecode,
  acceptsDevalue,
  isDevalue,
  DEVALUE_CONTENT_TYPE,
} from '../codec/devalue.ts'
import {
  encode as msgpackEncode,
  decode as msgpackDecode,
  acceptsMsgpack,
  isMsgpack,
  MSGPACK_CONTENT_TYPE,
} from '../codec/msgpack.ts'
import { ContextPool } from '../compile.ts'
import { compileRouter } from '../compile.ts'
import { generateOpenAPI, scalarHTML } from '../scalar.ts'

import { SilgiError, toSilgiError } from './error.ts'
import { routerCache } from './router-utils.ts'
import { ValidationError } from './schema.ts'
import { iteratorToEventStream } from './sse.ts'
import { stringifyJSON, parseEmptyableJSON } from './utils.ts'

import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { Hookable } from 'hookable'

// ── Response Encoding Helper ────────────────────────

export type ResponseFormat = 'json' | 'msgpack' | 'devalue'

export function encodeResponse(
  data: unknown,
  status: number,
  format: ResponseFormat,
  jsonStringify?: (v: unknown) => string,
  extraHeaders?: Record<string, string>,
): Response {
  switch (format) {
    case 'msgpack':
      return new Response(msgpackEncode(data), {
        status,
        headers: { 'content-type': MSGPACK_CONTENT_TYPE, ...extraHeaders },
      })
    case 'devalue':
      return new Response(devalueEncode(data), {
        status,
        headers: { 'content-type': DEVALUE_CONTENT_TYPE, ...extraHeaders },
      })
    default:
      return new Response(jsonStringify ? jsonStringify(data) : stringifyJSON(data), {
        status,
        headers: { 'content-type': 'application/json', ...extraHeaders },
      })
  }
}

// ── Fetch Handler ───────────────────────────────────

export function createFetchHandler(
  routerDef: import('../types.ts').RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks?: Hookable<SilgiHooks>,
  handlerOptions?: { scalar?: boolean | ScalarOptions },
): (request: Request) => Promise<Response> {
  // Compile router tree into JIT-compiled radix router
  let compiledRouter = routerCache.get(routerDef)
  if (!compiledRouter) {
    compiledRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledRouter)
  }

  // Context pool — zero allocation per request
  const ctxPool = new ContextPool()

  // Pre-allocate response headers (reused across requests)
  const jsonHeaders = { 'content-type': 'application/json' }
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

  return async (request: Request): Promise<Response> => {
    // FAST pathname extraction — 40x faster than new URL()
    const url = request.url
    const pathStart = url.indexOf('/', url.indexOf('//') + 2)
    const qMark = url.indexOf('?', pathStart)
    const pathname = qMark === -1 ? url.slice(pathStart + 1) : url.slice(pathStart + 1, qMark)

    // Scalar: /openapi.json and /reference
    if (scalarEnabled) {
      if (pathname === 'openapi.json') {
        return new Response(specJson, { headers: { 'content-type': 'application/json' } })
      }
      if (pathname === 'reference') {
        return new Response(specHtml, { headers: { 'content-type': 'text/html' } })
      }
    }

    // Compiled radix router lookup
    const match = compiledRouter!('POST', '/' + pathname)
    if (!match) {
      return new Response(notFoundBody, { status: 404, headers: jsonHeaders })
    }
    const route = match.data

    // Borrow context from pool
    const ctx = ctxPool.borrow()

    try {
      // Populate context — direct property copy instead of Object.assign
      const baseCtx = await contextFactory(request)
      const keys = Object.keys(baseCtx)
      for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]

      // Surface URL params from radix router match
      if (match.params) ctx.params = match.params

      // Parse input — use .json() directly when possible
      let rawInput: unknown
      if (request.method === 'GET') {
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
      } else {
        const ct = request.headers.get('content-type')
        if (isMsgpack(ct) && request.body) {
          const buf = new Uint8Array(await request.arrayBuffer())
          rawInput = buf.length > 0 ? msgpackDecode(buf) : undefined
        } else if (isDevalue(ct) && request.body) {
          const text = await request.text()
          rawInput = text ? devalueDecode(text) : undefined
        } else if (ct?.includes('json') && request.body) {
          const text = await request.text()
          rawInput = text ? JSON.parse(text) : undefined
        } else if (request.body) {
          const text = await request.text()
          rawInput = text ? parseEmptyableJSON(text) : undefined
        }
      }

      const t0 = performance.now()
      hooks?.callHook('request', { path: pathname, input: rawInput })

      // Execute compiled pipeline — sync dispatch when possible
      const pipelineResult = route.handler(ctx, rawInput, request.signal)
      const output = pipelineResult instanceof Promise ? await pipelineResult : pipelineResult

      // Raw Response passthrough — full control over headers, status, body
      if (output instanceof Response) {
        hooks?.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
        return output
      }

      // ReadableStream passthrough — binary downloads, file streaming
      if (output instanceof ReadableStream) {
        hooks?.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
        return new Response(output, { headers: { 'content-type': 'application/octet-stream' } })
      }

      // SSE streaming
      if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
        const stream = iteratorToEventStream(output as AsyncIterableIterator<unknown>)
        return new Response(stream, { headers: sseHeaders })
      }

      // Content negotiation: msgpack > devalue > json
      hooks?.callHook('response', { path: pathname, output, durationMs: performance.now() - t0 })
      const accept = request.headers.get('accept')
      const fmt = acceptsMsgpack(accept) ? 'msgpack' : acceptsDevalue(accept) ? 'devalue' : 'json'
      const cacheHeaders = route.cacheControl ? { 'cache-control': route.cacheControl } : undefined
      return encodeResponse(output, 200, fmt, route.stringify, cacheHeaders)
    } catch (error) {
      hooks?.callHook('error', { path: pathname, error })
      const accept = request.headers.get('accept')
      const fmt = acceptsMsgpack(accept) ? 'msgpack' : acceptsDevalue(accept) ? 'devalue' : 'json'
      if (error instanceof ValidationError) {
        const errBody = { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
        return encodeResponse(errBody, 400, fmt)
      }
      const e = error instanceof SilgiError ? error : toSilgiError(error)
      return encodeResponse(e.toJSON(), e.status, fmt)
    } finally {
      ctxPool.release(ctx)
    }
  }
}
