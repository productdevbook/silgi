/**
 * Message Port adapter — use Silgi over MessagePort/MessageChannel.
 *
 * Works with Electron (main↔renderer), browser extensions (background↔popup),
 * Web Workers, and Node.js Worker Threads.
 *
 * @example
 * ```ts
 * // Worker / Electron main
 * import { silgiMessagePort } from "silgi/message-port"
 *
 * const dispose = silgiMessagePort(appRouter, port, {
 *   context: () => ({ db: getDB() }),
 * })
 *
 * // Client side
 * import { MessagePortLink } from "silgi/message-port"
 * import { createClient } from "silgi/client"
 *
 * const client = createClient<AppRouter>(new MessagePortLink(port))
 * const users = await client.users.list({ limit: 10 })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { buildContext, serializeError } from '../core/dispatch.ts'
import { SilgiError } from '../core/error.ts'

import type { ClientLink, ClientOptions, ClientContext } from '../client/types.ts'
import type { RouterDef } from '../types.ts'

export interface MessagePortAdapterOptions<TCtx extends Record<string, unknown>> {
  context?: () => TCtx | Promise<TCtx>
}

interface RPCMessage {
  __silgi: true
  __type: 'request'
  id: string
  path: string
  input?: unknown
}

interface RPCResponse {
  __silgi: true
  __type: 'response'
  id: string
  result?: unknown
  error?: { code: string; status: number; message: string; data?: unknown }
}

/**
 * Attach Silgi to a MessagePort (server side).
 * Listens for RPC messages and responds with results.
 * Returns a dispose function to stop listening.
 */
export function silgiMessagePort<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  port: {
    postMessage(msg: unknown): void
    addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void
    removeEventListener(type: 'message', handler: (event: { data: unknown }) => void): void
  },
  options: MessagePortAdapterOptions<TCtx> = {},
): () => void {
  const flatRouter = compileRouter(router)

  const handler = async (event: { data: unknown }) => {
    const msg = event.data as RPCMessage
    if (!msg || typeof msg !== 'object' || !msg.__silgi || msg.__type !== 'request') return

    const match = flatRouter('POST', '/' + msg.path)
    if (!match) {
      port.postMessage({
        __silgi: true,
        __type: 'response',
        id: msg.id,
        error: { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' },
      } satisfies RPCResponse)
      return
    }
    const route = match.data

    try {
      const baseCtx = options.context ? await options.context() : undefined
      const ctx = buildContext(baseCtx as Record<string, unknown> | undefined, match.params)

      const ac = new AbortController()
      const result = await route.handler(ctx, msg.input, ac.signal)
      port.postMessage({ __silgi: true, __type: 'response', id: msg.id, result } satisfies RPCResponse)
    } catch (error) {
      port.postMessage({
        __silgi: true,
        __type: 'response',
        id: msg.id,
        error: serializeError(error),
      } satisfies RPCResponse)
    }
  }

  port.addEventListener('message', handler)
  return () => port.removeEventListener('message', handler)
}

/**
 * Client-side MessagePort link.
 * Sends RPC messages and resolves promises when responses arrive.
 */
export class MessagePortLink<TCtx extends ClientContext = ClientContext> implements ClientLink<TCtx> {
  #port: {
    postMessage(msg: unknown): void
    addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void
    removeEventListener?(type: 'message', handler: (event: { data: unknown }) => void): void
  }
  #pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  #nextId = 1
  #messageHandler: (event: { data: unknown }) => void

  constructor(port: {
    postMessage(msg: unknown): void
    addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void
    removeEventListener?(type: 'message', handler: (event: { data: unknown }) => void): void
  }) {
    this.#port = port
    this.#messageHandler = (event: { data: unknown }) => {
      const msg = event.data as RPCResponse
      if (!msg || typeof msg !== 'object' || !msg.__silgi || msg.__type !== 'response') return
      const pending = this.#pending.get(msg.id)
      if (!pending) return
      this.#pending.delete(msg.id)
      if (msg.error) {
        pending.reject(
          new SilgiError(msg.error.code, {
            status: msg.error.status,
            message: msg.error.message,
            data: msg.error.data,
          }),
        )
      } else {
        pending.resolve(msg.result)
      }
    }
    port.addEventListener('message', this.#messageHandler)
  }

  call(path: readonly string[], input: unknown, options: ClientOptions<TCtx>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(this.#nextId++)
      this.#pending.set(id, { resolve, reject })

      // Honour caller's abort signal
      if (options.signal) {
        options.signal.addEventListener(
          'abort',
          () => {
            const pending = this.#pending.get(id)
            if (pending) {
              this.#pending.delete(id)
              pending.reject(new DOMException('Aborted', 'AbortError'))
            }
          },
          { once: true },
        )
      }

      this.#port.postMessage({
        __silgi: true,
        __type: 'request',
        id,
        path: path.join('/'),
        input,
      } satisfies RPCMessage)
    })
  }

  /** Reject all pending calls and stop listening. */
  dispose(): void {
    for (const [, pending] of this.#pending) {
      pending.reject(new DOMException('Link disposed', 'AbortError'))
    }
    this.#pending.clear()
    this.#port.removeEventListener?.('message', this.#messageHandler)
  }
}
