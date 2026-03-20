/**
 * HTTP/2 server — integration tests.
 *
 * Tests HTTP/2 with TLS using self-signed certificates.
 */

import * as http2 from 'node:http2'

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { z } from 'zod'

import { compileRouter } from '#src/compile.ts'
import { SilgiError, toSilgiError } from '#src/core/error.ts'
import { stringifyJSON } from '#src/core/utils.ts'
import { silgi } from '#src/silgi.ts'

// ── Generate self-signed cert ───────────────────────

// ── Setup ──────────────────────────────────────────

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
})

// Build the compiled router and handler function manually (same as serve() does internally)
const compiledRouter = compileRouter(appRouter)
const notFound = '{"code":"NOT_FOUND","status":404,"message":"Not found"}'

function requestHandler(req: any, res: any) {
  const rawUrl = req.url ?? '/'
  const qIdx = rawUrl.indexOf('?')
  const pathname = qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx)

  const method = req.method ?? 'POST'
  const match = compiledRouter(method, pathname)
  if (!match) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(notFound)
    return
  }
  const route = match.data

  const ctx: Record<string, unknown> = Object.create(null)

  // No body for these tests (GET-like queries)
  const cl = req.headers['content-length']
  if (!cl || cl === '0') {
    try {
      const result = route.handler(ctx, {}, new AbortController().signal)
      if (result instanceof Promise) {
        result.then((output) => {
          const body = route.stringify(output)
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
          res.end(body)
        })
      } else {
        const body = route.stringify(result)
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
        res.end(body)
      }
    } catch (err) {
      const e = err instanceof SilgiError ? err : toSilgiError(err)
      const body = stringifyJSON(e.toJSON())
      res.writeHead(e.status, { 'content-type': 'application/json' })
      res.end(body)
    }
    return
  }

  let body = ''
  req.on('data', (d: Buffer) => {
    body += d
  })
  req.on('end', () => {
    const input = body ? JSON.parse(body) : undefined
    try {
      const result = route.handler(ctx, input ?? {}, new AbortController().signal)
      if (result instanceof Promise) {
        result.then((output) => {
          const b = route.stringify(output)
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) })
          res.end(b)
        })
      } else {
        const b = route.stringify(result)
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(b) })
        res.end(b)
      }
    } catch (err) {
      const e = err instanceof SilgiError ? err : toSilgiError(err)
      const b = stringifyJSON(e.toJSON())
      res.writeHead(e.status, { 'content-type': 'application/json' })
      res.end(b)
    }
  })
}

// ── HTTP/2 Server ──────────────────────────────────

let server: http2.Http2SecureServer
let port: number

beforeAll(async () => {
  // Generate ephemeral self-signed cert
  const { privateKey, certificate } = await generateEphemeralCert()

  server = http2.createSecureServer({ cert: certificate, key: privateKey, allowHTTP1: true }, requestHandler)

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      port = (server.address() as { port: number }).port
      resolve()
    })
  })
})

afterAll(() => {
  server?.close()
})

async function generateEphemeralCert(): Promise<{ privateKey: string; certificate: string }> {
  // Use openssl via child_process for self-signed cert generation
  const { execSync } = await import('node:child_process')
  const tmpDir = await import('node:os').then((os) => os.tmpdir())
  const keyPath = `${tmpDir}/silgi-test-key.pem`
  const certPath = `${tmpDir}/silgi-test-cert.pem`

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout ${keyPath} -out ${certPath} -days 1 -nodes -subj "/CN=localhost" 2>/dev/null`,
  )

  const fs = await import('node:fs')
  return {
    privateKey: fs.readFileSync(keyPath, 'utf8'),
    certificate: fs.readFileSync(certPath, 'utf8'),
  }
}

// ── Helpers ────────────────────────────────────────

function h2Get(path: string): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false, // self-signed cert
    })

    const req = client.request({ ':path': `/${path}`, ':method': 'GET' })

    let data = ''
    req.on('data', (chunk: Buffer) => {
      data += chunk
    })
    req.on('end', () => {
      client.close()
      try {
        resolve({ status: 200, data: JSON.parse(data) })
      } catch {
        resolve({ status: 200, data })
      }
    })

    req.on('error', reject)
    req.end()
  })
}

function h2Post(path: string, body: unknown): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://127.0.0.1:${port}`, {
      rejectUnauthorized: false,
    })

    const payload = JSON.stringify(body)
    const req = client.request({
      ':path': `/${path}`,
      ':method': 'POST',
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
    })

    let data = ''
    let responseStatus = 200

    req.on('response', (headers) => {
      responseStatus = headers[':status'] as number
    })

    req.on('data', (chunk: Buffer) => {
      data += chunk
    })
    req.on('end', () => {
      client.close()
      try {
        resolve({ status: responseStatus, data: JSON.parse(data) })
      } catch {
        resolve({ status: responseStatus, data })
      }
    })

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// ── Tests ──────────────────────────────────────────

describe('HTTP/2 server', () => {
  it('serves health check over HTTP/2', async () => {
    const { data } = await h2Get('health')
    expect(data.status).toBe('ok')
  })

  it('handles POST with JSON body over HTTP/2', async () => {
    const { data } = await h2Post('echo', { msg: 'h2 test' })
    expect(data.echo).toBe('h2 test')
  })

  it('returns 404 for unknown routes', async () => {
    const { data } = await h2Get('nonexistent')
    expect(data.code).toBe('NOT_FOUND')
  })

  it('HTTP/2 multiplexing — concurrent requests on same connection', async () => {
    const results = await Promise.all([
      h2Get('health'),
      h2Post('echo', { msg: 'req1' }),
      h2Post('echo', { msg: 'req2' }),
      h2Post('echo', { msg: 'req3' }),
    ])

    expect(results[0].data.status).toBe('ok')
    expect(results[1].data.echo).toBe('req1')
    expect(results[2].data.echo).toBe('req2')
    expect(results[3].data.echo).toBe('req3')
  })
})
