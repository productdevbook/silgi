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
  /** Use MessagePack binary protocol instead of JSON */
  binary?: boolean
  /** Context factory — receives the peer on each message */
  context?: (peer: Peer) => TCtx | Promise<TCtx>
}

interface RPCRequest {
  id: string
  path: string
  input?: unknown
}

// Track active AbortControllers per peer for cleanup on disconnect
const peerAbortControllers = new WeakMap<Peer, Set<AbortController>>()

/**
 * Create crossws-compatible hooks for Silgi RPC over WebSocket.
 *
 * Works with any crossws integration — Nitro, Deno, Bun, Cloudflare, etc.
 *
 * @example
 * ```ts
 * // Nitro / Nuxt
 * import { createWSHooks } from "silgi/ws";
 * export default defineWebSocketHandler(createWSHooks(appRouter));
 *
 * // With context
 * export default defineWebSocketHandler(createWSHooks(appRouter, {
 *   context: (peer) => ({ userId: peer.request?.headers.get('x-user-id') }),
 * }));
 * ```
 */
export function createWSHooks<TCtx extends Record<string, unknown>>(
  routerDef: RouterDef,
  options: WSAdapterOptions<TCtx> = {},
): Partial<WSHooks> {
  const flat = compileRouter(routerDef)
  const binary = options.binary ?? false
  const contextFactory = options.context

  function send(peer: Peer, data: unknown): void {
    if (binary) {
      peer.send(msgpackEncode(data) as ArrayBuffer)
    } else {
      peer.send(stringifyJSON(data))
    }
  }

  function parseMessage(message: Message): RPCRequest {
    if (binary) {
      return msgpackDecode(message.uint8Array()) as RPCRequest
    }
    return message.json<RPCRequest>()
  }

  return {
    open(peer) {
      peerAbortControllers.set(peer, new Set())
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

      // Route lookup — only procedures with ws: true are accessible
      const route = flat('POST', '/' + path)?.data
      if (!route || !route.ws) {
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
  const ws = nodeAdapter({ hooks: createWSHooks(routerDef, options) })

  server.on('upgrade', (req, socket, head) => {
    ws.handleUpgrade(req, socket, head)
  })
}
