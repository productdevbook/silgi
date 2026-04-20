/**
 * WebSocket RPC adapter — powered by crossws.
 *
 * Bidirectional type-safe RPC over WebSocket.
 * Supports subscriptions (server → client streaming) natively.
 *
 * Protocol:
 *   Client → Server: { id: string, path: string, input?: unknown }
 *   Server → Client: { id: string, result?: unknown, error?: unknown }
 *   Server → Client (stream): { id: string, data: unknown, done?: boolean }
 */

import { encode as msgpackEncode, decode as msgpackDecode } from './codec/msgpack.ts'
import { compileRouter, createContext, releaseContext } from './compile.ts'
import { SilgiError, toSilgiError } from './core/error.ts'
import { stringifyJSON } from './core/utils.ts'

import type { RouterDef } from './types.ts'
import type { Peer, Message, Hooks as WSHooks } from 'crossws'
import type { Server as HttpServer } from 'node:http'

export interface WSAdapterOptions<TCtx extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Wire protocol for WebSocket message encoding.
   *
   * - `'json'` — default, text frames with JSON
   * - `'messagepack'` — binary frames with MessagePack
   *
   * @default 'json'
   */
  protocol?: 'json' | 'messagepack'

  /**
   * @deprecated Use `protocol: 'messagepack'` instead.
   */
  binary?: boolean
  /** Context factory — receives the peer on each message */
  context?: (peer: Peer) => TCtx | Promise<TCtx>
  /**
   * Enable per-message-deflate compression.
   *
   * - `true`: enable with defaults
   * - `object`: fine-tune zlib options (passed to ws `perMessageDeflate`)
   *
   * @default false
   */
  compress?:
    | boolean
    | {
        threshold?: number
        serverNoContextTakeover?: boolean
        clientNoContextTakeover?: boolean
        serverMaxWindowBits?: number
        clientMaxWindowBits?: number
      }
  /**
   * Maximum allowed message size in bytes.
   * Messages exceeding this limit will cause the connection to be closed.
   *
   * @default 1_048_576 (1 MB)
   */
  maxPayload?: number
  /**
   * Keepalive ping interval in milliseconds.
   * Server sends a ping frame at this interval; if the client
   * does not respond with a pong before the next ping, the connection is terminated.
   *
   * Set to `0` or `false` to disable.
   *
   * @default 30_000 (30 seconds)
   */
  keepalive?: number | false
}

interface RPCRequest {
  id: string
  path: string
  input?: unknown
}

/**
 * Internal — build crossws-compatible hooks for Silgi RPC over WebSocket.
 *
 * Used by `attachWebSocket()`, `serve({ ws: true })`, and `handler()` auto-WS.
 * Not part of the public API; callers should use one of those higher-level entry points.
 */
/** @internal — exported only for use by silgi.ts handler() and attachWebSocket(). Not part of the public API. */
export function _createWSHooks<TCtx extends Record<string, unknown>>(
  routerDef: RouterDef,
  options: WSAdapterOptions<TCtx> = {},
): Partial<WSHooks> {
  const flat = compileRouter(routerDef)
  const useMsgpack = options.protocol === 'messagepack' || (options.protocol == null && (options.binary ?? false))
  const contextFactory = options.context
  const keepaliveMs = options.keepalive === false ? 0 : (options.keepalive ?? 30_000)

  // Per-hookset registries — closed over by the returned open/message/close
  // handlers. Scoped here (not module-global) so two silgi instances sharing
  // a process cannot scribble into each other's peer state. Keys are the
  // Peer objects crossws hands us; GC releases entries when the peer is
  // collected, same as WeakMap semantics dictate.
  const peerAbortControllers = new WeakMap<Peer, Set<AbortController>>()
  const peerKeepaliveTimers = new WeakMap<Peer, ReturnType<typeof setInterval>>()

  function send(peer: Peer, data: unknown): void {
    const compress = !!options.compress
    if (useMsgpack) {
      peer.send(msgpackEncode(data) as ArrayBuffer, { compress })
    } else {
      peer.send(stringifyJSON(data), { compress })
    }
  }

  function parseMessage(message: Message): RPCRequest {
    if (useMsgpack) {
      return msgpackDecode(message.uint8Array()) as RPCRequest
    }
    return message.json<RPCRequest>()
  }

  return {
    open(peer) {
      peerAbortControllers.set(peer, new Set())

      // Keepalive — ping at interval, terminate if no pong before next ping
      if (keepaliveMs > 0) {
        const ws = (peer as any)._internal?.ws
        if (ws && typeof ws.ping === 'function') {
          let alive = true
          ws.on('pong', () => {
            alive = true
          })
          const timer = setInterval(() => {
            if (!alive) {
              clearInterval(timer)
              ws.terminate()
              return
            }
            alive = false
            ws.ping()
          }, keepaliveMs)
          // Store timer for cleanup
          peerKeepaliveTimers.set(peer, timer)
        }
      }
    },

    async message(peer, message) {
      let req: RPCRequest
      try {
        req = parseMessage(message)
      } catch {
        send(peer, { id: '0', error: { code: 'BAD_REQUEST', status: 400, message: 'Invalid message format' } })
        return
      }

      const { id, path, input } = req

      // Route lookup — all procedures are accessible via WS, no flag required
      const route = flat('POST', '/' + path)?.data
      if (!route) {
        send(peer, { id, error: { code: 'NOT_FOUND', status: 404, message: `Procedure "${path}" not found` } })
        return
      }

      // Build context from pool
      const ctx = createContext()
      if (contextFactory) {
        try {
          const baseResult = contextFactory(peer)
          const base = baseResult instanceof Promise ? await baseResult : baseResult
          const keys = Object.keys(base)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = (base as Record<string, unknown>)[keys[i]!]
        } catch (err) {
          releaseContext(ctx)
          const e = err instanceof SilgiError ? err : toSilgiError(err)
          send(peer, { id, error: e.toJSON() })
          return
        }
      }

      // AbortController per call — aborted on peer disconnect
      const ac = new AbortController()
      const controllers = peerAbortControllers.get(peer)
      controllers?.add(ac)

      try {
        const result = route.handler(ctx, input ?? {}, ac.signal)
        const output = result instanceof Promise ? await result : result

        // Streaming (subscription)
        if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
          const iter = output as AsyncIterableIterator<unknown>
          try {
            for await (const data of iter) {
              if (ac.signal.aborted) break
              send(peer, { id, data })
            }
            if (!ac.signal.aborted) {
              send(peer, { id, data: null, done: true })
            }
          } catch (err) {
            if (!ac.signal.aborted) {
              const e = err instanceof SilgiError ? err : toSilgiError(err)
              send(peer, { id, error: e.toJSON() })
            }
          } finally {
            await iter.return?.()
          }
          return
        }

        // Single response
        send(peer, { id, result: output })
      } catch (err) {
        const e = err instanceof SilgiError ? err : toSilgiError(err)
        send(peer, { id, error: e.toJSON() })
      } finally {
        controllers?.delete(ac)
        releaseContext(ctx)
      }
    },

    close(peer, _details) {
      // Clear keepalive timer
      const timer = peerKeepaliveTimers.get(peer)
      if (timer) {
        clearInterval(timer)
        peerKeepaliveTimers.delete(peer)
      }

      // Abort all in-flight requests for this peer
      const controllers = peerAbortControllers.get(peer)
      if (controllers) {
        for (const ac of controllers) ac.abort()
        controllers.clear()
        peerAbortControllers.delete(peer)
      }
    },

    error(_peer, error) {
      console.error('[silgi:ws] error:', error)
    },
  }
}

/**
 * Attach WebSocket RPC handler to an existing Node.js HTTP server.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { attachWebSocket } from "silgi/ws";
 *
 * const server = createServer(httpHandler);
 * attachWebSocket(server, appRouter);
 * server.listen(3000);
 * ```
 */
export async function attachWebSocket<TCtx extends Record<string, unknown>>(
  server: HttpServer,
  routerDef: RouterDef,
  options: WSAdapterOptions<TCtx> = {},
): Promise<void> {
  const nodeAdapter = (await import('crossws/adapters/node')).default

  // Build ws ServerOptions for compression and maxPayload
  const serverOptions: Record<string, unknown> = {}

  if (options.compress) {
    serverOptions.perMessageDeflate = typeof options.compress === 'object' ? options.compress : true
  }

  if (options.maxPayload !== undefined) {
    serverOptions.maxPayload = options.maxPayload
  }

  const ws = nodeAdapter({
    hooks: _createWSHooks(routerDef, options),
    ...(Object.keys(serverOptions).length > 0 && { serverOptions }),
  })

  server.on('upgrade', (req, socket, head) => {
    ws.handleUpgrade(req, socket, head)
  })
}
