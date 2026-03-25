/**
 * Graceful shutdown tests.
 *
 * Tests that serve() returns a SilgiServer handle with close() method,
 * and that graceful shutdown configuration works correctly.
 */

import { describe, it, expect, afterEach } from 'vitest'

import { silgi } from '#src/silgi.ts'

import type { SilgiServer } from '#src/core/serve.ts'

// ── Setup ──────────────────────────────────────────

const k = silgi({ context: () => ({}) })

const appRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
})

let server: SilgiServer | undefined

afterEach(async () => {
  if (server) {
    await server.close(true)
    server = undefined
  }
})

// ── Tests ──────────────────────────────────────────

describe('graceful shutdown', () => {
  it('serve() returns SilgiServer with url, port, hostname, close', async () => {
    server = await k.serve(appRouter, { port: 0, gracefulShutdown: false })

    expect(server).toBeDefined()
    expect(server.hostname).toBe('127.0.0.1')
    expect(typeof server.url).toBe('string')
    expect(server.url).toMatch(/^http:\/\//)
    expect(typeof server.close).toBe('function')
  })

  it('close() stops the server — new requests fail', async () => {
    server = await k.serve(appRouter, { port: 0, gracefulShutdown: false })
    const url = server.url

    // Server works before close
    const before = await fetch(`${url}/health`, { method: 'POST' })
    expect(before.status).toBe(200)

    // Close server
    await server.close()
    server = undefined

    // New requests should fail
    await expect(fetch(`${url}/health`, { method: 'POST' })).rejects.toThrow()
  })

  it('serve:stop hook is called on close', async () => {
    let stopCalled = false
    const k2 = silgi({
      context: () => ({}),
      hooks: {
        'serve:stop': () => {
          stopCalled = true
        },
      },
    })
    const router2 = k2.router({ health: k2.$resolve(() => 'ok') })

    const s = await k2.serve(router2, { port: 0, gracefulShutdown: false })

    expect(stopCalled).toBe(false)
    await s.close()
    expect(stopCalled).toBe(true)
  })

  it('accepts gracefulShutdown: true (default)', async () => {
    server = await k.serve(appRouter, { port: 0, gracefulShutdown: true })
    expect(server).toBeDefined()
  })

  it('accepts gracefulShutdown with timeout config', async () => {
    server = await k.serve(appRouter, {
      port: 0,
      gracefulShutdown: { timeout: 5000, forceTimeout: 10000 },
    })
    expect(server).toBeDefined()
  })
})
