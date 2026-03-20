import { defu } from 'defu'
import { getPort } from 'get-port-please'

import { compileRouter } from '../compile.ts'
import { generateOpenAPI, scalarHTML, resolveScalarLocal } from '../scalar.ts'

import { SilgiError, toSilgiError } from './error.ts'
import { routerCache } from './router-utils.ts'
import { stringifyJSON } from './utils.ts'

import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { RouterDef } from '../types.ts'
import type { Hookable } from 'hookable'

// ── Serve Handler ───────────────────────────────────

export function createServeHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks: Hookable<SilgiHooks>,
  options?: {
    port?: number
    hostname?: string
    scalar?: boolean | ScalarOptions
    ws?: boolean
    http2?: { cert: string; key: string }
  },
): void {
  // Compile router ONCE
  let compiledServeRouter = routerCache.get(routerDef)
  if (!compiledServeRouter) {
    compiledServeRouter = compileRouter(routerDef)
    routerCache.set(routerDef, compiledServeRouter)
  }

  const opts = defu(options ?? {}, { port: 3000, hostname: '127.0.0.1' })
  const hostname = opts.hostname
  const fr = compiledServeRouter
  // Per-request AbortController created inside handler below
  const scalarEnabled = !!options?.scalar

  const notFound = '{"code":"NOT_FOUND","status":404,"message":"Not found"}'

  const useHttp2 = !!options?.http2
  const useWs = !!options?.ws

  // Find available port, then start server
  Promise.all([
    getPort({ port: opts.port, host: hostname, alternativePortRange: [3000, 3100] }),
    useHttp2 ? import('node:http2') : import('node:http'),
  ]).then(async ([port, httpMod]) => {
    // Scalar API Reference (needs resolved port for URL)
    let specJson: string | undefined
    let specHtml: string | undefined
    let scalarLocalJs: string | undefined
    if (scalarEnabled) {
      const scalarOpts = typeof options!.scalar === 'object' ? options!.scalar : {}
      const spec = generateOpenAPI(routerDef, scalarOpts)
      specJson = JSON.stringify(spec)
      specHtml = scalarHTML(`http://${hostname}:${port}/openapi.json`, scalarOpts)
      // Pre-load local Scalar JS if cdn: 'local'
      if (scalarOpts.cdn === 'local') {
        const content = await resolveScalarLocal()
        if (!content) {
          console.warn(
            '  [silgi] cdn: "local" requires @scalar/api-reference installed.\n' +
              '           Run: pnpm add @scalar/api-reference\n' +
              '           Falling back to CDN.',
          )
          specHtml = scalarHTML(`http://${hostname}:${port}/openapi.json`, { ...scalarOpts, cdn: 'cdn' })
        } else {
          scalarLocalJs = content
        }
      }
    }
    const handler = (req: any, res: any) => {
      const rawUrl = req.url ?? '/'
      const qIdx = rawUrl.indexOf('?')
      const pathname = qIdx === -1 ? rawUrl.slice(1) : rawUrl.slice(1, qIdx)

      // Scalar routes (only if enabled)
      if (scalarEnabled) {
        if (pathname === 'openapi.json') {
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(specJson!) })
          res.end(specJson)
          return
        }
        if (pathname === 'reference') {
          res.writeHead(200, { 'content-type': 'text/html', 'content-length': Buffer.byteLength(specHtml!) })
          res.end(specHtml)
          return
        }
        if (pathname === '__silgi/scalar.js' && scalarLocalJs) {
          res.writeHead(200, {
            'content-type': 'application/javascript',
            'content-length': Buffer.byteLength(scalarLocalJs),
            'cache-control': 'public, max-age=86400',
          })
          res.end(scalarLocalJs)
          return
        }
      }

      const match = fr('POST', '/' + pathname)
      if (!match) {
        res.writeHead(404, { 'content-type': 'application/json', 'content-length': notFound.length })
        res.end(notFound)
        return
      }
      const route = match.data

      // FIX #1: No Proxy — plain object with iterable protocol (saves 200-500ns/req)
      // FIX #2: Object literal with stable hidden class (not Object.create(null))
      const hdrs = req.headers
      const iterableHeaders: any = {}
      const hkeys = Object.keys(hdrs)
      for (let i = 0; i < hkeys.length; i++) {
        const hk = hkeys[i]!
        const v = hdrs[hk]
        iterableHeaders[hk] = Array.isArray(v) ? v[0] : v
      }
      iterableHeaders[Symbol.iterator] = function* () {
        for (const hk of hkeys) {
          const v = hdrs[hk]
          if (v !== undefined) yield [hk, Array.isArray(v) ? v[0] : v]
        }
      }

      const fakeReq = {
        url: `http://${hdrs.host ?? 'localhost'}${rawUrl}`,
        method: req.method,
        headers: iterableHeaders,
      }

      // FIX #3: No per-request closures — inline respond/error logic
      // FIX #2b: Don't use pool (delete causes V8 dictionary mode)
      const ctx: Record<string, unknown> = Object.create(null)
      // Surface URL params from radix router match
      if (match.params) ctx.params = match.params
      const ac = new AbortController()
      req.on('close', () => ac.abort())

      const t0 = performance.now()

      const respond = async (output: unknown) => {
        // Raw Response passthrough
        if (output instanceof Response) {
          res.writeHead(output.status, Object.fromEntries(output.headers))
          if (output.body) {
            const reader = output.body.getReader()
            const pump = async () => {
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                res.write(value)
              }
              res.end()
            }
            await pump()
          } else {
            res.end(await output.text())
          }
          hooks.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
          return
        }

        // ReadableStream passthrough
        if (output instanceof ReadableStream) {
          res.writeHead(200, { 'content-type': 'application/octet-stream' })
          const reader = (output as ReadableStream<Uint8Array>).getReader()
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
          res.end()
          hooks.callHook('response', { path: pathname, output: null, durationMs: performance.now() - t0 })
          return
        }

        const body = route.stringify(output)
        const headers: Record<string, string | number> = {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        }
        if (route.cacheControl) headers['cache-control'] = route.cacheControl
        res.writeHead(200, headers)
        res.end(body)
        hooks.callHook('response', { path: pathname, output, durationMs: performance.now() - t0 })
      }

      const handleError = (err: unknown) => {
        if (!res.headersSent) {
          const e = err instanceof SilgiError ? err : toSilgiError(err)
          const body = stringifyJSON(e.toJSON())
          res.writeHead(e.status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
          res.end(body)
        }
        hooks.callHook('error', { path: pathname, error: err })
      }

      const runWithContext = (rawInput: unknown) => {
        try {
          const baseCtx = contextFactory(fakeReq as any)
          if (baseCtx instanceof Promise) {
            baseCtx
              .then((resolved) => {
                const keys = Object.keys(resolved)
                for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = resolved[keys[i]!]
                executePipeline(rawInput)
              })
              .catch(handleError)
          } else {
            const keys = Object.keys(baseCtx)
            for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
            executePipeline(rawInput)
          }
        } catch (err) {
          handleError(err)
        }
      }

      const executePipeline = (rawInput: unknown) => {
        try {
          const pr = route.handler(ctx, rawInput, ac.signal)
          if (pr instanceof Promise) {
            pr.then(respond).catch(handleError)
          } else {
            respond(pr)
          }
        } catch (err) {
          handleError(err)
        }
      }

      // NO BODY: sync fast path
      const cl = hdrs['content-length']
      const method = req.method ?? 'GET'
      if (!cl || cl === '0' || method === 'GET' || method === 'HEAD') {
        if (cl) req.resume()
        hooks.callHook('request', { path: pathname, input: undefined })
        runWithContext(undefined)
        return
      }

      // WITH BODY: callback-based (with size limit and parse safety)
      const MAX_BODY_SIZE = 1_048_576 // 1 MB default
      let body = ''
      let aborted = false
      req.on('data', (d: Buffer) => {
        if (aborted) return
        if (body.length + d.length > MAX_BODY_SIZE) {
          aborted = true
          req.destroy()
          handleError(new SilgiError('PAYLOAD_TOO_LARGE', { status: 413, message: 'Request body too large' }))
          return
        }
        body += d
      })
      req.on('end', () => {
        if (aborted) return
        let input: unknown
        try {
          input = body ? JSON.parse(body) : undefined
        } catch {
          handleError(new SilgiError('BAD_REQUEST', { status: 400, message: 'Invalid JSON body' }))
          return
        }
        hooks.callHook('request', { path: pathname, input })
        runWithContext(input)
      })
    }

    // Create server (HTTP/1.1 or HTTP/2)
    let server: any
    if (useHttp2 && options?.http2) {
      const h2 = httpMod as typeof import('node:http2')
      const fs = await import('node:fs')
      server = h2.createSecureServer(
        {
          cert: fs.readFileSync(options.http2.cert),
          key: fs.readFileSync(options.http2.key),
          allowHTTP1: true, // fallback for non-h2 clients
        },
        handler,
      )
    } else {
      const h1 = httpMod as typeof import('node:http')
      server = h1.createServer({ keepAlive: true, requestTimeout: 30_000, headersTimeout: 10_000 }, handler)
    }

    // Attach WebSocket if enabled
    if (useWs) {
      const { attachWebSocket } = await import('../ws.ts')
      attachWebSocket(server, routerDef)
    }

    const protocol = useHttp2 ? 'https' : 'http'
    server.listen(port, hostname, () => {
      const url = `${protocol}://${hostname}:${port}`
      console.log(`\nSilgi server running at ${url}`)
      if (useHttp2) console.log(`  HTTP/2 enabled (with HTTP/1.1 fallback)`)
      if (useWs) console.log(`  WebSocket RPC at ws://${hostname}:${port}`)
      if (scalarEnabled) console.log(`  Scalar API Reference at ${url}/reference`)
      console.log()
      hooks.callHook('serve:start', { url, port, hostname })
    })
  })
}
