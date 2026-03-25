import { serve } from 'srvx'

import { createFetchHandler } from './handler.ts'

import type { AnalyticsOptions } from '../plugins/analytics.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { RouterDef } from '../types.ts'
import type { WSAdapterOptions } from '../ws.ts'
import type { FetchHandler } from './handler.ts'
import type { Hookable } from 'hookable'

// ── Server Handle ───────────────────────────────────

export interface SilgiServer {
  /** Server URL (e.g. "http://127.0.0.1:3000") */
  readonly url: string
  /** Configured port */
  readonly port: number
  /** Configured hostname */
  readonly hostname: string

  /**
   * Gracefully shut down the server.
   *
   * By default waits for in-flight requests to complete.
   * Pass `true` to forcefully terminate all active connections immediately.
   */
  close(forceCloseConnections?: boolean): Promise<void>
}

// ── Serve Options ───────────────────────────────────

export interface ServeOptions {
  port?: number
  hostname?: string
  /** Enable Scalar API Reference UI at /reference and /openapi.json */
  scalar?: boolean | ScalarOptions
  /** Enable analytics dashboard at /analytics */
  analytics?: boolean | AnalyticsOptions
  /** Enable WebSocket RPC (requires crossws) */
  ws?: boolean | WSAdapterOptions
  /** Enable HTTP/2 (requires cert + key for TLS) */
  http2?: { cert: string; key: string }
  /**
   * Graceful shutdown on SIGINT/SIGTERM signals.
   *
   * - `true` (default): enables graceful shutdown with srvx defaults
   * - `false`: disables automatic signal handling
   * - `object`: fine-tune timeouts
   *
   * @default true
   */
  gracefulShutdown?:
    | boolean
    | {
        /** Max time (ms) to wait for in-flight requests before force-closing */
        timeout?: number
        /** Max time (ms) after graceful period before process.exit */
        forceTimeout?: number
      }
}

// ── Serve Handler ───────────────────────────────────

export async function createServeHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks: Hookable<SilgiHooks>,
  options?: ServeOptions,
): Promise<SilgiServer> {
  const port = options?.port ?? 3000
  const hostname = options?.hostname ?? '127.0.0.1'

  // Build handler pipeline: base → scalar → analytics
  let handler: FetchHandler = createFetchHandler(routerDef, contextFactory, hooks)

  if (options?.scalar) {
    const { wrapWithScalar } = await import('../scalar.ts')
    const scalarOpts = typeof options.scalar === 'object' ? options.scalar : {}
    handler = wrapWithScalar(handler, routerDef, scalarOpts)
  }

  if (options?.analytics) {
    const { wrapWithAnalytics } = await import('../plugins/analytics.ts')
    const analyticsOpts = typeof options.analytics === 'object' ? options.analytics : {}
    handler = wrapWithAnalytics(handler, analyticsOpts)
  }

  // Resolve graceful shutdown config
  const shutdownOpt = options?.gracefulShutdown ?? true
  let gracefulShutdown: boolean | { gracefulTimeout?: number; forceTimeout?: number }
  if (typeof shutdownOpt === 'object') {
    gracefulShutdown = {
      gracefulTimeout: shutdownOpt.timeout,
      forceTimeout: shutdownOpt.forceTimeout,
    }
  } else {
    gracefulShutdown = shutdownOpt
  }

  const server = await serve({
    port,
    hostname,
    fetch: handler,
    gracefulShutdown,
    silent: true,

    // TLS / HTTP/2
    ...(options?.http2 && {
      tls: {
        cert: options.http2.cert,
        key: options.http2.key,
      },
    }),
  })

  // Wait for server to be fully ready (resolves url, address, etc.)
  await server.ready()

  // Resolve actual URL — srvx populates url after ready()
  let resolvedPort = port
  if (server.node?.server) {
    const addr = server.node.server.address()
    if (addr && typeof addr === 'object') resolvedPort = addr.port
  }
  const protocol = options?.http2 ? 'https' : 'http'
  const rawUrl = server.url || `${protocol}://${hostname}:${resolvedPort}`
  // Normalize — strip trailing slash for consistent concatenation
  const url = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl

  // Attach WebSocket if enabled
  if (options?.ws && server.node?.server) {
    const { attachWebSocket } = await import('../ws.ts')
    const nodeServer = server.node.server as import('node:http').Server
    const wsOpts = typeof options.ws === 'object' ? options.ws : undefined
    await attachWebSocket(nodeServer, routerDef, wsOpts)
  }

  console.log(`\nSilgi server running at ${url}`)
  if (options?.http2) console.log(`  HTTP/2 enabled (with HTTP/1.1 fallback)`)
  if (options?.ws) console.log(`  WebSocket RPC at ws://${hostname}:${resolvedPort}`)
  if (options?.scalar) console.log(`  Scalar API Reference at ${url}/reference`)
  if (options?.analytics) console.log(`  Analytics dashboard at ${url}/analytics`)
  console.log()

  await hooks.callHook('serve:start', { url, port: resolvedPort, hostname })

  // Return server handle
  const silgiServer: SilgiServer = {
    url,
    port: resolvedPort,
    hostname,
    async close(forceCloseConnections = false) {
      await server.close(forceCloseConnections)
      await hooks.callHook('serve:stop', { url, port: resolvedPort, hostname })
    },
  }

  return silgiServer
}
