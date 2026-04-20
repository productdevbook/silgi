/**
 * WebSocket RPC adapter
 * -----------------------
 *
 * Exposes silgi procedures over a WebSocket connection using the
 * `crossws` runtime-agnostic adapter underneath. Every procedure
 * registered via `router()` is reachable — no opt-in flag required.
 *
 * Wire protocol
 * -------------
 *
 *   Client → Server:  { id, path, input? }
 *   Server → Client:  { id, result?, error? }                  (single value)
 *   Server → Client:  { id, data, done? }                      (streaming chunk)
 *
 * Requests are correlated by `id`. A subscription (any resolver that returns
 * an async iterable) streams back one `{ id, data }` frame per yielded
 * value, followed by a terminal `{ id, data: null, done: true }`. Clients
 * close a subscription by closing the socket; the peer disconnect aborts
 * every in-flight resolver for that peer.
 *
 * Two encodings are supported: UTF-8 JSON (default) and binary MessagePack.
 * The choice is per-adapter, not per-message.
 */

import { encode as msgpackEncode, decode as msgpackDecode } from './codec/msgpack.ts'
import { compileRouter } from './compile.ts'
import { SilgiError, toSilgiError } from './core/error.ts'
import { stringifyJSON } from './core/utils.ts'

import type { RouterDef } from './types.ts'
import type { Peer, Message, Hooks as WSHooks } from 'crossws'
import type { Server as HttpServer } from 'node:http'

export interface WSAdapterOptions<TCtx extends Record<string, unknown> = Record<string, unknown>> {
  /**
   * Wire protocol for WebSocket message encoding.
   *
   * - `'json'` — default, text frames with JSON.
   * - `'messagepack'` — binary frames with MessagePack.
   *
   * @default 'json'
   */
  protocol?: 'json' | 'messagepack'

  /** @deprecated Use `protocol: 'messagepack'` instead. */
  binary?: boolean

  /** Context factory — invoked for every incoming peer message. */
  context?: (peer: Peer) => TCtx | Promise<TCtx>

  /**
   * Enable per-message-deflate compression.
   *
   * - `true`  — enable with library defaults.
   * - object  — zlib tuning, forwarded to `ws.perMessageDeflate`.
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
   * Maximum allowed message size in bytes. Exceeding the limit closes
   * the connection.
   *
   * @default 1_048_576 (1 MB)
   */
  maxPayload?: number

  /**
   * Keepalive ping interval in milliseconds. The server sends a ping
   * every `keepalive` ms; if the client does not pong before the next
   * ping, the socket is terminated.
   *
   * Set to `0` or `false` to disable keepalive entirely.
   *
   * @default 30_000
   */
  keepalive?: number | false
}

interface RPCRequest {
  id: string
  path: string
  input?: unknown
}

/**
 * Build the crossws hook set that implements silgi's WebSocket RPC.
 *
 * @internal
 *
 * This is not part of the public API — `silgi({...}).handler()`,
 * `serve({ ws: true })`, and `attachWebSocket()` are the three supported
 * entry points. They all go through this builder so protocol behavior
 * stays identical everywhere.
 */
export function _createWSHooks<TCtx extends Record<string, unknown>>(
  routerDef: RouterDef,
  options: WSAdapterOptions<TCtx> = {},
): Partial<WSHooks> {
  const compiled = compileRouter(routerDef)
  const useMsgpack = options.protocol === 'messagepack' || (options.protocol == null && (options.binary ?? false))
  const contextFactory = options.context
  const keepaliveMs = options.keepalive === false ? 0 : (options.keepalive ?? 30_000)

  // Per-hookset state. Kept on `WeakMap`s keyed by the peer so that two
  // silgi instances running in the same process never cross-contaminate
  // each other's peer state. Entries get collected automatically when
  // the peer object is GC'd.
  const peerAbortControllers = new WeakMap<Peer, Set<AbortController>>()
  const peerKeepaliveTimers = new WeakMap<Peer, ReturnType<typeof setInterval>>()

  /** Send a single frame, applying the peer's chosen encoding and compression. */
  const send = (peer: Peer, data: unknown): void => {
    const compress = !!options.compress
    if (useMsgpack) {
      peer.send(msgpackEncode(data) as ArrayBuffer, { compress })
    } else {
      peer.send(stringifyJSON(data), { compress })
    }
  }

  /** Decode an incoming frame into an `RPCRequest`. Throws on parse error. */
  const parseMessage = (message: Message): RPCRequest => {
    if (useMsgpack) {
      return msgpackDecode(message.uint8Array()) as RPCRequest
    }
    return message.json<RPCRequest>()
  }

  /**
   * Build the per-request context.
   *
   * Isolated here so the message handler stays readable; the caller
   * handles send-back-error on failure.
   */
  const buildContext = async (peer: Peer): Promise<Record<string, unknown>> => {
    const ctx = Object.create(null) as Record<string, unknown>
    if (contextFactory) {
      const base = await contextFactory(peer)
      for (const key of Object.keys(base)) {
        ctx[key] = (base as Record<string, unknown>)[key]
      }
    }
    return ctx
  }

  /**
   * Stream a subscription result back to the peer. Returns when the
   * iterator is exhausted, the peer disconnects, or the resolver throws.
   *
   * `iter.return?.()` is called in `finally` so the resolver's cleanup
   * (database cursors, external watchers, etc.) runs even on disconnect.
   */
  const streamSubscription = async (
    peer: Peer,
    id: string,
    iter: AsyncIterableIterator<unknown>,
    signal: AbortSignal,
  ): Promise<void> => {
    try {
      for await (const data of iter) {
        if (signal.aborted) break
        send(peer, { id, data })
      }
      if (!signal.aborted) {
        send(peer, { id, data: null, done: true })
      }
    } catch (err) {
      if (!signal.aborted) {
        send(peer, { id, error: toClientError(err) })
      }
    } finally {
      await iter.return?.()
    }
  }

  /**
   * Install a keepalive ping loop on a peer, if the runtime gives us
   * access to the underlying `ws` instance. Silently no-ops when it
   * does not — some adapters (e.g. Bun) do not expose that handle.
   */
  const installKeepalive = (peer: Peer): void => {
    if (keepaliveMs <= 0) return
    const ws = (
      peer as unknown as { _internal?: { ws?: { ping?: () => void; on?: Function; terminate?: () => void } } }
    )._internal?.ws
    if (!ws || typeof ws.ping !== 'function' || typeof ws.on !== 'function' || typeof ws.terminate !== 'function') {
      return
    }

    let alive = true
    ws.on('pong', () => {
      alive = true
    })
    const timer = setInterval(() => {
      if (!alive) {
        clearInterval(timer)
        ws.terminate!()
        return
      }
      alive = false
      ws.ping!()
    }, keepaliveMs)
    peerKeepaliveTimers.set(peer, timer)
  }

  return {
    open(peer) {
      peerAbortControllers.set(peer, new Set())
      installKeepalive(peer)
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

      const route = compiled('POST', '/' + path)?.data
      if (!route) {
        send(peer, { id, error: { code: 'NOT_FOUND', status: 404, message: `Procedure "${path}" not found` } })
        return
      }

      let ctx: Record<string, unknown>
      try {
        ctx = await buildContext(peer)
      } catch (err) {
        send(peer, { id, error: toClientError(err) })
        return
      }

      // A fresh `AbortController` per call lets us abort every in-flight
      // resolver when the peer disconnects. The `close` hook walks the
      // set and calls `.abort()` on each.
      const ac = new AbortController()
      peerAbortControllers.get(peer)?.add(ac)

      try {
        const output = await route.handler(ctx, input ?? {}, ac.signal)

        if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
          await streamSubscription(peer, id, output as AsyncIterableIterator<unknown>, ac.signal)
        } else {
          send(peer, { id, result: output })
        }
      } catch (err) {
        send(peer, { id, error: toClientError(err) })
      } finally {
        peerAbortControllers.get(peer)?.delete(ac)
      }
    },

    close(peer) {
      const timer = peerKeepaliveTimers.get(peer)
      if (timer) {
        clearInterval(timer)
        peerKeepaliveTimers.delete(peer)
      }

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

/** Normalize any thrown value into the `{ code, status, message, ... }` shape clients expect. */
function toClientError(err: unknown): ReturnType<SilgiError['toJSON']> {
  return (err instanceof SilgiError ? err : toSilgiError(err)).toJSON()
}

/**
 * Attach silgi's WebSocket RPC to an existing Node.js `http.Server`.
 *
 * @example
 *   import { createServer } from 'node:http'
 *   import { attachWebSocket } from 'silgi/ws'
 *
 *   const server = createServer(httpHandler)
 *   await attachWebSocket(server, appRouter)
 *   server.listen(3000)
 */
export async function attachWebSocket<TCtx extends Record<string, unknown>>(
  server: HttpServer,
  routerDef: RouterDef,
  options: WSAdapterOptions<TCtx> = {},
): Promise<void> {
  const nodeAdapter = (await import('crossws/adapters/node')).default

  // Forward compression / payload-limit options through to the
  // underlying `ws` library (the `serverOptions` slot on crossws is the
  // pass-through hatch for those).
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
