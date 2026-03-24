import { serve } from 'srvx'

import { createFetchHandler } from './handler.ts'

import type { AnalyticsOptions } from '../plugins/analytics.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { RouterDef } from '../types.ts'
import type { FetchHandler } from './handler.ts'
import type { Hookable } from 'hookable'

// ── Serve Handler ───────────────────────────────────

export async function createServeHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks: Hookable<SilgiHooks>,
  options?: {
    port?: number
    hostname?: string
    scalar?: boolean | ScalarOptions
    analytics?: boolean | AnalyticsOptions
    ws?: boolean
    http2?: { cert: string; key: string }
  },
): Promise<void> {
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

  const server = await serve({
    port,
    hostname,
    fetch: handler,

    // TLS / HTTP/2
    ...(options?.http2 && {
      tls: {
        cert: options.http2.cert,
        key: options.http2.key,
      },
    }),
  })

  const url = server.url || `http://${hostname}:${port}`

  // Attach WebSocket if enabled
  if (options?.ws && server.node?.server) {
    const { attachWebSocket } = await import('../ws.ts')
    const nodeServer = server.node.server as import('node:http').Server
    await attachWebSocket(nodeServer, routerDef)
  }

  console.log(`\nSilgi server running at ${url}`)
  if (options?.http2) console.log(`  HTTP/2 enabled (with HTTP/1.1 fallback)`)
  if (options?.ws) console.log(`  WebSocket RPC at ws://${hostname}:${port}`)
  if (options?.scalar) console.log(`  Scalar API Reference at ${url}/reference`)
  if (options?.analytics) console.log(`  Analytics dashboard at ${url}/analytics`)
  console.log()

  await hooks.callHook('serve:start', { url, port, hostname })
}
