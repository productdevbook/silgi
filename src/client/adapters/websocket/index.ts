/**
 * WebSocket client link — bidirectional RPC over WebSocket.
 *
 * Uses the same wire protocol as the server-side ws.ts adapter:
 *   Client → Server: { id: string, path: string, input?: unknown }
 *   Server → Client: { id: string, result?: unknown, error?: unknown }
 *   Server → Client (stream): { id: string, data: unknown, done?: boolean }
 *
 * @example
 * ```ts
 * import { WSLink } from 'silgi/client/ws'
 *
 * const link = new WSLink({ url: 'ws://localhost:3000/ws' })
 * const client = createClient<AppRouter>(link)
 * ```
 */

import { SilgiError } from '../../../core/error.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'

export interface WSLinkOptions {
  /** WebSocket URL (e.g. 'ws://localhost:3000/ws') */
  url: string | URL
  /** Wire protocol (default: 'json') */
  protocol?: 'json' | 'messagepack'
  /** Custom WebSocket constructor (default: globalThis.WebSocket) */
  WebSocket?: typeof globalThis.WebSocket
}

interface PendingCall {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

export class WSLink<TClientContext extends ClientContext = ClientContext> implements ClientLink<TClientContext> {
  #url: string
  #WebSocket: typeof globalThis.WebSocket
  #ws: WebSocket | undefined
  #pending = new Map<string, PendingCall>()
  #nextId = 0
  #connecting: Promise<void> | undefined

  constructor(options: WSLinkOptions) {
    this.#url = typeof options.url === 'string' ? options.url : options.url.href
    this.#WebSocket = options.WebSocket ?? globalThis.WebSocket
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown> {
    await this.#ensureConnected()

    const id = String(this.#nextId++)

    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })

      // Abort support
      options.signal?.addEventListener(
        'abort',
        () => {
          this.#pending.delete(id)
          reject(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )

      const msg = { id, path: path.join('/'), input }
      this.#ws!.send(JSON.stringify(msg))
    })
  }

  #ensureConnected(): Promise<void> {
    if (this.#ws?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.#connecting) return this.#connecting

    this.#connecting = new Promise<void>((resolve, reject) => {
      const ws = new this.#WebSocket(this.#url)
      ws.binaryType = 'arraybuffer'

      ws.addEventListener('open', () => {
        this.#ws = ws
        this.#connecting = undefined
        resolve()
      })

      ws.addEventListener('error', () => {
        this.#connecting = undefined
        reject(new SilgiError('INTERNAL_SERVER_ERROR', { message: 'WebSocket connection failed' }))
      })

      ws.addEventListener('message', (event) => {
        const msg = JSON.parse(typeof event.data === 'string' ? event.data : new TextDecoder().decode(event.data))
        const pending = this.#pending.get(msg.id)
        if (!pending) return

        if (msg.error) {
          this.#pending.delete(msg.id)
          const err = msg.error
          pending.reject(
            new SilgiError(err.code ?? 'INTERNAL_SERVER_ERROR', {
              status: err.status,
              message: err.message,
              data: err.data,
            }),
          )
        } else if (msg.done) {
          this.#pending.delete(msg.id)
          pending.resolve(msg.data)
        } else if ('result' in msg) {
          this.#pending.delete(msg.id)
          pending.resolve(msg.result)
        }
        // Stream data (msg.data without msg.done) — would need async iterator support
        // For now, only single request/response is supported
      })

      ws.addEventListener('close', () => {
        this.#ws = undefined
        // Reject all pending
        for (const [, p] of this.#pending) {
          p.reject(new SilgiError('INTERNAL_SERVER_ERROR', { message: 'WebSocket closed' }))
        }
        this.#pending.clear()
      })
    })

    return this.#connecting
  }

  /** Close the WebSocket connection and reject all pending calls */
  dispose(): void {
    this.#ws?.close()
    for (const [, p] of this.#pending) {
      p.reject(new DOMException('Link disposed', 'AbortError'))
    }
    this.#pending.clear()
  }
}
