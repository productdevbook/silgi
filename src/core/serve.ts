import { serve } from 'srvx'

import { _createWSHooks } from '../ws.ts'

import { createFetchHandler, wrapHandler } from './handler.ts'
import { normalizePrefix } from './url.ts'

import type { AnalyticsOptions } from '../plugins/analytics.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { RouterDef } from '../types.ts'
import type { WSAdapterOptions } from '../ws.ts'
import type { ContextBridge } from './context-bridge.ts'
import type { FetchHandler } from './handler.ts'
import type { SchemaRegistry } from './schema-converter.ts'
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
  /** URL path prefix (e.g. "/api"). Only requests matching this prefix are handled; others return 404. */
  basePath?: string
  port?: number
  hostname?: string
  /** Enable Scalar API Reference UI at /api/reference and /api/openapi.json */
  scalar?: boolean | ScalarOptions
  /** Enable analytics dashboard at /api/analytics — requires `auth` to be set */
  analytics?: AnalyticsOptions
  /**
   * WebSocket RPC configuration.
   *
   * Defaults to auto-enabled when the router contains any subscription procedure.
   * Pass `false` to disable, or an options object to fine-tune crossws (compression, keepalive, maxPayload).
   */
  ws?: false | WSAdapterOptions
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

// ── Runtime detection ──────────────────────────────

type Runtime = 'node' | 'bun' | 'deno'

function detectRuntime(): Runtime {
  if (typeof (globalThis as any).Bun !== 'undefined') return 'bun'
  if (typeof (globalThis as any).Deno !== 'undefined') return 'deno'
  return 'node'
}

function routerHasSubscription(def: any): boolean {
  if (!def || typeof def !== 'object') return false
  if (def.type === 'subscription') return true
  for (const v of Object.values(def)) {
    if (routerHasSubscription(v)) return true
  }
  return false
}

// ── Serve Handler ───────────────────────────────────

export async function createServeHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks: Hookable<SilgiHooks>,
  options?: ServeOptions,
  schemaRegistry?: SchemaRegistry,
  bridge?: ContextBridge,
): Promise<SilgiServer> {
  const port = options?.port ?? 3000
  const hostname = options?.hostname ?? '127.0.0.1'
  const prefix = options?.basePath ? normalizePrefix(options.basePath) : undefined

  // Build handler pipeline: base → scalar → analytics
  const httpHandler: FetchHandler = wrapHandler(
    createFetchHandler(routerDef, contextFactory, hooks, prefix, bridge),
    routerDef,
    options ? { ...options, schemaRegistry, hooks } : { schemaRegistry, hooks },
    prefix,
  )

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

  // Decide WS: explicit `false` disables, otherwise auto-enable when subscriptions present
  const wsExplicitlyDisabled = options?.ws === false
  const wsOpts = typeof options?.ws === 'object' ? options.ws : undefined
  const wsEnabled = !wsExplicitlyDisabled && routerHasSubscription(routerDef)

  const runtime = detectRuntime()

  // Per-runtime WS wiring — lazy, only when enabled
  let fetchHandler: FetchHandler = httpHandler
  let bunWebsocket: unknown
  // Late-bound Bun server reference (populated after srvx starts)
  const bunServerRef: { current: unknown } = { current: undefined }
  let nodeAttach: ((server: any) => Promise<void>) | undefined

  if (wsEnabled) {
    const hooksObj = _createWSHooks(routerDef, wsOpts)

    if (runtime === 'bun') {
      const bunAdapter = (await import('crossws/adapters/bun')).default
      const adapter = bunAdapter({ hooks: hooksObj })
      bunWebsocket = adapter.websocket
      fetchHandler = (async (req: Request) => {
        if (req.headers.get('upgrade') === 'websocket' && bunServerRef.current) {
          const res = await adapter.handleUpgrade(req, bunServerRef.current as any)
          if (res) return res
        }
        return httpHandler(req)
      }) as FetchHandler
    } else if (runtime === 'deno') {
      const denoAdapter = (await import('crossws/adapters/deno')).default
      const adapter = denoAdapter({ hooks: hooksObj })
      fetchHandler = (async (req: Request) => {
        if (req.headers.get('upgrade') === 'websocket') {
          return adapter.handleUpgrade(req, {})
        }
        return httpHandler(req)
      }) as FetchHandler
    } else {
      // Node — attach after srvx builds the http.Server
      nodeAttach = async (httpServer: any) => {
        const { attachWebSocket } = await import('../ws.ts')
        await attachWebSocket(httpServer, routerDef, wsOpts)
      }
    }
  }

  const server = await serve({
    port,
    hostname,
    fetch: fetchHandler,
    gracefulShutdown,
    silent: true,

    // TLS / HTTP/2
    ...(options?.http2 && {
      tls: {
        cert: options.http2.cert,
        key: options.http2.key,
      },
    }),

    // Bun: inject websocket handler
    ...(bunWebsocket ? { bun: { websocket: bunWebsocket } as any } : {}),
  })

  // Wait for server to be fully ready (resolves url, address, etc.)
  await server.ready()

  // Bun: capture the underlying server so the fetch handler can call adapter.handleUpgrade
  if (runtime === 'bun' && server.bun?.server) {
    bunServerRef.current = server.bun.server
  }

  // Node: attach crossws to the http.Server now that it exists
  if (nodeAttach && server.node?.server) {
    await nodeAttach(server.node.server)
  }

  // Resolve actual URL — srvx populates url after ready()
  let resolvedPort = port
  if (server.node?.server) {
    const addr = server.node.server.address()
    if (addr && typeof addr === 'object') resolvedPort = addr.port
  } else if (server.bun?.server) {
    resolvedPort = server.bun.server.port ?? port
  }
  const protocol = options?.http2 ? 'https' : 'http'
  const rawUrl = server.url || `${protocol}://${hostname}:${resolvedPort}`
  // Normalize — strip trailing slash for consistent concatenation
  const url = rawUrl.endsWith('/') ? rawUrl.slice(0, -1) : rawUrl

  console.log(`\nSilgi server running at ${url}`)
  if (options?.http2) console.log(`  HTTP/2 enabled (with HTTP/1.1 fallback)`)
  if (wsEnabled) console.log(`  WebSocket RPC at ws://${hostname}:${resolvedPort}/_ws (${runtime})`)
  if (options?.scalar) console.log(`  Scalar API Reference at ${url}/api/reference`)
  if (options?.analytics) console.log(`  Analytics dashboard at ${url}/api/analytics`)
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
