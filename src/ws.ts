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

import nodeAdapter from 'crossws/adapters/node'

import { encode as msgpackEncode, decode as msgpackDecode } from './codec/msgpack.ts'
import { compileRouter } from './compile.ts'
import { KatmanError, toKatmanError } from './core/error.ts'
import { stringifyJSON } from './core/utils.ts'

import type { FlatRouter } from './compile.ts'
import type { RouterDef } from './types.ts'
import type { Peer, Message } from 'crossws'
import type { Server as HttpServer } from 'node:http'

export interface WSAdapterOptions {
  /** Use MessagePack binary protocol instead of JSON */
  binary?: boolean
}

interface RPCRequest {
  id: string
  path: string
  input?: unknown
}

/**
 * Attach WebSocket RPC handler to an existing Node.js HTTP server.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { attachWebSocket } from "katman/ws";
 *
 * const server = createServer(httpHandler);
 * attachWebSocket(server, appRouter);
 * server.listen(3000);
 * ```
 */
export function attachWebSocket(server: HttpServer, routerDef: RouterDef, options: WSAdapterOptions = {}): void {
  // Compile router once
  const flat: FlatRouter = compileRouter(routerDef)
  const binary = options.binary ?? false

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

  const ws = nodeAdapter({
    hooks: {
      open(peer) {
        // Connection opened — no action needed
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

        // Route lookup
        const route = flat.get(path)
        if (!route) {
          send(peer, { id, error: { code: 'NOT_FOUND', status: 404, message: `Procedure "${path}" not found` } })
          return
        }

        // Execute pipeline
        const ctx: Record<string, unknown> = Object.create(null)
        const ac = new AbortController()
        try {
          const result = route.handler(ctx, input ?? {}, ac.signal)
          const output = result instanceof Promise ? await result : result

          // Streaming (subscription)
          if (output && typeof output === 'object' && Symbol.asyncIterator in (output as object)) {
            const iter = output as AsyncIterableIterator<unknown>
            try {
              for await (const data of iter) {
                send(peer, { id, data })
              }
              send(peer, { id, data: null, done: true })
            } catch (err) {
              const e = err instanceof KatmanError ? err : toKatmanError(err)
              send(peer, { id, error: e.toJSON() })
            }
            return
          }

          // Single response
          send(peer, { id, result: output })
        } catch (err) {
          const e = err instanceof KatmanError ? err : toKatmanError(err)
          send(peer, { id, error: e.toJSON() })
        }
      },

      close(_peer, _details) {
        // Connection closed — cleanup if needed
      },

      error(_peer, error) {
        console.error('[katman:ws] error:', error)
      },
    },
  })

  // Attach to existing HTTP server
  server.on('upgrade', (req, socket, head) => {
    ws.handleUpgrade(req, socket, head)
  })
}
