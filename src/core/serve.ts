/**
 * `serve()` orchestrator
 * ------------------------
 *
 * Builds a Node/Bun/Deno HTTP server from a silgi router. The heavy
 * lifting (the compiled Fetch handler, analytics/Scalar wrappers) is
 * already done elsewhere; this module stitches them together with the
 * runtime-specific WebSocket upgrade plumbing and hands off to `srvx`.
 *
 * The only per-runtime work that lives here is mounting WebSocket hooks
 * for subscriptions:
 *
 *   - **Bun**   — inject crossws into `serve({ bun: { websocket } })`
 *                 and intercept upgrade requests at the Fetch layer.
 *   - **Deno**  — intercept upgrade requests at the Fetch layer and
 *                 call the crossws Deno adapter directly.
 *   - **Node**  — after srvx exposes the `http.Server`, attach crossws
 *                 via `server.on('upgrade', …)`.
 *
 * Everything else is shared: URL resolution, graceful shutdown, hook
 * firing, and the startup banner.
 */

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

// ─── Public surface ───────────────────────────────────────────────────

export interface SilgiServer {
  /** Full server URL, e.g. `http://127.0.0.1:3000`. */
  readonly url: string
  /** Port the server actually bound to (may differ from requested when `0`). */
  readonly port: number
  /** Hostname the server bound to. */
  readonly hostname: string
  /**
   * Gracefully shut the server down.
   *
   * Waits for in-flight requests by default. Pass `true` to drop
   * active connections immediately.
   */
  close(forceCloseConnections?: boolean): Promise<void>
}

export interface ServeOptions {
  /** URL path prefix (e.g. `/api`). Requests outside the prefix 404. */
  basePath?: string
  port?: number
  hostname?: string
  /** Mount the Scalar API Reference UI at `/api/reference`. */
  scalar?: boolean | ScalarOptions
  /** Mount the analytics dashboard at `/api/analytics` (requires `auth`). */
  analytics?: AnalyticsOptions
  /**
   * WebSocket RPC configuration.
   *
   * Auto-enabled when the router contains any subscription procedure.
   * Pass `false` to disable, or an options object to tune crossws
   * (compression, keepalive, maxPayload).
   */
  ws?: false | WSAdapterOptions
  /** TLS material for HTTP/2. When set, the server serves HTTPS. */
  http2?: { cert: string; key: string }
  /**
   * Graceful shutdown on `SIGINT` / `SIGTERM`.
   *
   *   - `true`   — enable with srvx defaults (recommended).
   *   - `false`  — disable automatic signal handling.
   *   - object   — fine-tune timeouts.
   *
   * @default true
   */
  gracefulShutdown?:
    | boolean
    | {
        /** Max ms to wait for in-flight requests before force-closing. */
        timeout?: number
        /** Max ms after graceful period before `process.exit`. */
        forceTimeout?: number
      }
}

// ─── Runtime detection ────────────────────────────────────────────────

type Runtime = 'node' | 'bun' | 'deno'

/**
 * Detect the current JavaScript runtime from well-known globals.
 *
 * Written as a plain function rather than reading a module-global so
 * the check re-evaluates when the module is imported into a different
 * runtime (e.g. a test that spawns a Bun child process).
 */
function detectRuntime(): Runtime {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined') return 'bun'
  if (typeof (globalThis as { Deno?: unknown }).Deno !== 'undefined') return 'deno'
  return 'node'
}

// ─── Subscription detection ───────────────────────────────────────────

/**
 * Walk the router tree looking for a subscription. We stop at the first
 * hit because we only need to decide whether to wire up WS at all — we
 * do not need an inventory.
 *
 * Mirrors the helper in `silgi.ts`; kept here so `core/serve.ts` has no
 * runtime dependency on the top-level instance module.
 */
function routerHasSubscription(def: unknown): boolean {
  if (!def || typeof def !== 'object') return false
  if ((def as { type?: string }).type === 'subscription') return true
  for (const child of Object.values(def as Record<string, unknown>)) {
    if (routerHasSubscription(child)) return true
  }
  return false
}

// ─── Shutdown config ──────────────────────────────────────────────────

/** srvx's internal shutdown config shape. Different field names than ours. */
type SrvxShutdown = boolean | { gracefulTimeout?: number; forceTimeout?: number }

/**
 * Translate our `gracefulShutdown` option into the shape srvx expects.
 *
 * srvx uses `gracefulTimeout`, we expose `timeout` — the rename keeps
 * the public API readable without leaking srvx vocabulary.
 */
function resolveShutdown(option: ServeOptions['gracefulShutdown']): SrvxShutdown {
  if (option === undefined || typeof option === 'boolean') {
    return option ?? true
  }
  return {
    gracefulTimeout: option.timeout,
    forceTimeout: option.forceTimeout,
  }
}

// ─── WebSocket wiring ─────────────────────────────────────────────────

/**
 * Per-runtime WebSocket setup.
 *
 *   - `fetch` — the final Fetch handler srvx should call. When WS is
 *     enabled, this handler intercepts upgrade requests before
 *     delegating the rest to the HTTP handler.
 *   - `bunWebsocket` — set for Bun; passed through to `serve({ bun })`.
 *   - `attachNode` — set for Node; called once srvx exposes the
 *     underlying `http.Server`.
 */
interface WSWiring {
  fetch: FetchHandler
  bunWebsocket?: unknown
  attachNode?: (server: unknown) => Promise<void>
}

/**
 * Build the WS wiring for the current runtime.
 *
 * Everything stays lazy: when no subscriptions exist or WS is
 * explicitly disabled, we return `{ fetch: httpHandler }` and never
 * import the crossws adapters.
 */
async function wireWebSocket(
  routerDef: RouterDef,
  httpHandler: FetchHandler,
  enabled: boolean,
  wsOpts: WSAdapterOptions | undefined,
  runtime: Runtime,
  bunServerRef: { current: unknown },
): Promise<WSWiring> {
  if (!enabled) return { fetch: httpHandler }

  const hooksObj = _createWSHooks(routerDef, wsOpts)

  if (runtime === 'bun') {
    const bunAdapter = (await import('crossws/adapters/bun')).default
    const adapter = bunAdapter({ hooks: hooksObj })
    return {
      bunWebsocket: adapter.websocket,
      // Upgrade requests hit the Fetch handler first; we hand them off
      // to crossws if it recognises the upgrade, otherwise fall through
      // to the regular HTTP handler.
      fetch: (async (req: Request) => {
        if (req.headers.get('upgrade') === 'websocket' && bunServerRef.current) {
          const res = await adapter.handleUpgrade(req, bunServerRef.current as any)
          if (res) return res
        }
        return httpHandler(req)
      }) as FetchHandler,
    }
  }

  if (runtime === 'deno') {
    const denoAdapter = (await import('crossws/adapters/deno')).default
    const adapter = denoAdapter({ hooks: hooksObj })
    return {
      fetch: (async (req: Request) => {
        if (req.headers.get('upgrade') === 'websocket') {
          return adapter.handleUpgrade(req, {})
        }
        return httpHandler(req)
      }) as FetchHandler,
    }
  }

  // Node — crossws needs the underlying `http.Server`, which srvx only
  // exposes after `serve()` returns. We hand back an `attachNode`
  // callback and let the caller run it at the right moment.
  return {
    fetch: httpHandler,
    attachNode: async (httpServer) => {
      const { attachWebSocket } = await import('../ws.ts')
      await attachWebSocket(httpServer as Parameters<typeof attachWebSocket>[0], routerDef, wsOpts)
    },
  }
}

// ─── URL resolution ───────────────────────────────────────────────────

/**
 * Compute the final server URL from srvx's output.
 *
 * srvx usually populates `server.url` itself, but when the caller
 * requests port `0` (pick-any-free) or when HTTP/2 is on, we have to
 * piece it together from the runtime-specific socket info. Trailing
 * slashes are stripped so `${url}/api/foo` always produces exactly one
 * separator.
 */
function resolveUrl(
  server: Awaited<ReturnType<typeof serve>>,
  requestedPort: number,
  hostname: string,
  http2: boolean,
): { url: string; port: number } {
  let port = requestedPort
  if (server.node?.server) {
    const addr = server.node.server.address()
    if (addr && typeof addr === 'object') port = addr.port
  } else if (server.bun?.server) {
    port = server.bun.server.port ?? requestedPort
  }

  const protocol = http2 ? 'https' : 'http'
  const raw = server.url || `${protocol}://${hostname}:${port}`
  const url = raw.endsWith('/') ? raw.slice(0, -1) : raw
  return { url, port }
}

// ─── Startup banner ───────────────────────────────────────────────────

/**
 * Print the startup banner.
 *
 * Side-effect-y and intentionally not bypassable — a server starting
 * silently is a surprising default; `silent: true` on srvx suppresses
 * *its* banner, but silgi still wants to show where it bound.
 */
function printBanner(
  url: string,
  hostname: string,
  port: number,
  runtime: Runtime,
  options: ServeOptions | undefined,
  wsEnabled: boolean,
): void {
  console.log(`\nSilgi server running at ${url}`)
  if (options?.http2) console.log(`  HTTP/2 enabled (with HTTP/1.1 fallback)`)
  if (wsEnabled) console.log(`  WebSocket RPC at ws://${hostname}:${port}/_ws (${runtime})`)
  if (options?.scalar) console.log(`  Scalar API Reference at ${url}/api/reference`)
  if (options?.analytics) console.log(`  Analytics dashboard at ${url}/api/analytics`)
  console.log()
}

// ─── Main entry point ─────────────────────────────────────────────────

/**
 * Build and start the HTTP (and optionally WebSocket) server.
 *
 * The function is intentionally long because the steps are strictly
 * ordered: WS wiring has to happen before srvx starts (Bun needs its
 * websocket handler at construction time); the `http.Server` only
 * exists once srvx returns (Node attaches WS there); and the banner
 * wants real bound port info. Splitting further would hide the
 * ordering more than it would simplify anything.
 */
export async function createServeHandler(
  routerDef: RouterDef,
  contextFactory: (req: Request) => Record<string, unknown> | Promise<Record<string, unknown>>,
  hooks: Hookable<SilgiHooks>,
  options?: ServeOptions,
  schemaRegistry?: SchemaRegistry,
  bridge?: ContextBridge,
): Promise<SilgiServer> {
  const requestedPort = options?.port ?? 3000
  const hostname = options?.hostname ?? '127.0.0.1'
  const prefix = options?.basePath ? normalizePrefix(options.basePath) : undefined

  // The HTTP pipeline: base fetch handler wrapped with Scalar/analytics
  // (when configured). This is what request flows through when the
  // request is not a WebSocket upgrade.
  const httpHandler: FetchHandler = wrapHandler(
    createFetchHandler(routerDef, contextFactory, hooks, prefix, bridge),
    routerDef,
    options ? { ...options, schemaRegistry, hooks } : { schemaRegistry, hooks },
    prefix,
  )

  const runtime = detectRuntime()
  const wsExplicitlyDisabled = options?.ws === false
  const wsEnabled = !wsExplicitlyDisabled && routerHasSubscription(routerDef)
  const wsOpts = typeof options?.ws === 'object' ? options.ws : undefined

  // On Bun, `adapter.handleUpgrade` needs the *Bun server* object, but
  // we only obtain that after srvx finishes starting. The wiring
  // closure captures this ref; we fill it in below.
  const bunServerRef: { current: unknown } = { current: undefined }

  const wiring = await wireWebSocket(routerDef, httpHandler, wsEnabled, wsOpts, runtime, bunServerRef)

  const server = await serve({
    port: requestedPort,
    hostname,
    fetch: wiring.fetch,
    gracefulShutdown: resolveShutdown(options?.gracefulShutdown),
    silent: true,
    ...(options?.http2
      ? { tls: { cert: options.http2.cert, key: options.http2.key } }
      : {}),
    ...(wiring.bunWebsocket ? ({ bun: { websocket: wiring.bunWebsocket } } as any) : {}),
  })

  // Wait for srvx to finish bootstrapping before we read `server.url`
  // or hand the underlying `http.Server` to crossws.
  await server.ready()

  if (runtime === 'bun' && server.bun?.server) {
    bunServerRef.current = server.bun.server
  }

  if (wiring.attachNode && server.node?.server) {
    await wiring.attachNode(server.node.server)
  }

  const { url, port } = resolveUrl(server, requestedPort, hostname, Boolean(options?.http2))

  printBanner(url, hostname, port, runtime, options, wsEnabled)

  await hooks.callHook('serve:start', { url, port, hostname })

  return {
    url,
    port,
    hostname,
    async close(forceCloseConnections = false) {
      await server.close(forceCloseConnections)
      await hooks.callHook('serve:stop', { url, port, hostname })
    },
  }
}
