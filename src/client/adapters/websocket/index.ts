/**
 * WebSocket client link — bidirectional RPC over WebSocket.
 *
 * Uses the same wire protocol as the server-side ws.ts adapter:
 *   Client → Server: { id: string, path: string, input?: unknown }
 *   Server → Client: { id: string, result?: unknown, error?: unknown }
 *   Server → Client (stream): { id: string, data: unknown, done?: boolean }
 *
 * Single-response calls return a Promise; streaming calls (subscriptions)
 * resolve to an AsyncIterableIterator that yields each `data` message until
 * the terminating `{ done: true }` frame.
 *
 * @example
 * ```ts
 * import { WSLink } from 'silgi/client/ws'
 *
 * const link = new WSLink({ url: 'ws://localhost:3000/_ws' })
 * const client = createClient<AppRouter>(link)
 *
 * // Query/mutation — single response
 * const users = await client.users.list()
 *
 * // Subscription — async iterator
 * const iter = await client.onUserUpdate()
 * for await (const ev of iter) console.log(ev)
 * ```
 */

import { encode as msgpackEncode, decode as msgpackDecode } from '../../../codec/msgpack.ts'
import { SilgiError } from '../../../core/error.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'

export interface WSLinkOptions {
  /** WebSocket URL (e.g. 'ws://localhost:3000/_ws') */
  url: string | URL
  /** Wire protocol (default: 'json') */
  protocol?: 'json' | 'messagepack'
  /** Custom WebSocket constructor (default: globalThis.WebSocket) */
  WebSocket?: typeof globalThis.WebSocket
}

/** Internal: pending single-response call */
interface PendingSingle {
  kind: 'single'
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
}

/** Internal: active streaming subscription */
interface PendingStream {
  kind: 'stream'
  push: (value: unknown) => void
  end: () => void
  fail: (reason: unknown) => void
}

/** Queue-backed async iterator used for subscription streams */
function createStreamIterator<T>(): {
  iter: AsyncIterableIterator<T>
  push: (v: T) => void
  end: () => void
  fail: (err: unknown) => void
} {
  const values: T[] = []
  const waiters: Array<{ resolve: (r: IteratorResult<T>) => void; reject: (e: unknown) => void }> = []
  let done = false
  let error: unknown = undefined

  const push = (v: T): void => {
    if (done) return
    const w = waiters.shift()
    if (w) w.resolve({ value: v, done: false })
    else values.push(v)
  }

  const end = (): void => {
    if (done) return
    done = true
    while (waiters.length > 0) {
      waiters.shift()!.resolve({ value: undefined as any, done: true })
    }
  }

  const fail = (err: unknown): void => {
    if (done) return
    done = true
    error = err
    while (waiters.length > 0) {
      waiters.shift()!.reject(err)
    }
  }

  const iter: AsyncIterableIterator<T> = {
    [Symbol.asyncIterator]() {
      return this
    },
    next(): Promise<IteratorResult<T>> {
      if (values.length > 0) {
        return Promise.resolve({ value: values.shift()!, done: false })
      }
      if (done) {
        if (error !== undefined) return Promise.reject(error)
        return Promise.resolve({ value: undefined as any, done: true })
      }
      return new Promise((resolve, reject) => {
        waiters.push({ resolve, reject })
      })
    },
    return(): Promise<IteratorResult<T>> {
      end()
      return Promise.resolve({ value: undefined as any, done: true })
    },
  }

  return { iter, push, end, fail }
}

export class WSLink<TClientContext extends ClientContext = ClientContext> implements ClientLink<TClientContext> {
  #url: string
  #WebSocket: typeof globalThis.WebSocket
  #ws: WebSocket | undefined
  #pending = new Map<string, PendingSingle | PendingStream>()
  #nextId = 0
  #connecting: Promise<void> | undefined
  #useMsgpack: boolean

  constructor(options: WSLinkOptions) {
    this.#url = typeof options.url === 'string' ? options.url : options.url.href
    this.#WebSocket = options.WebSocket ?? globalThis.WebSocket
    this.#useMsgpack = options.protocol === 'messagepack'
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown> {
    await this.#ensureConnected()

    const id = String(this.#nextId++)

    return new Promise<unknown>((resolve, reject) => {
      // Start as single; upgrade to stream on first `data` message
      this.#pending.set(id, {
        kind: 'single',
        resolve: (value) => {
          // If value is actually the first stream frame, upgrade
          resolve(value)
        },
        reject,
      })

      options.signal?.addEventListener(
        'abort',
        () => {
          const p = this.#pending.get(id)
          if (!p) return
          this.#pending.delete(id)
          if (p.kind === 'single') p.reject(new DOMException('Aborted', 'AbortError'))
          else p.fail(new DOMException('Aborted', 'AbortError'))
        },
        { once: true },
      )

      const msg = { id, path: path.join('/'), input }
      this.#sendFrame(msg)
    })
  }

  #sendFrame(msg: unknown): void {
    if (this.#useMsgpack) {
      this.#ws!.send(msgpackEncode(msg) as ArrayBuffer)
    } else {
      this.#ws!.send(JSON.stringify(msg))
    }
  }

  #decodeFrame(data: string | ArrayBuffer | Blob): any {
    if (this.#useMsgpack) {
      if (data instanceof ArrayBuffer) return msgpackDecode(new Uint8Array(data))
      if (typeof data === 'string') return JSON.parse(data) // fallback
      throw new SilgiError('INTERNAL_SERVER_ERROR', { message: 'Unexpected Blob frame' })
    }
    return JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer))
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
        let msg: any
        try {
          msg = this.#decodeFrame(event.data)
        } catch {
          return
        }

        const pending = this.#pending.get(msg.id)
        if (!pending) return

        // Error frame — terminate
        if (msg.error) {
          this.#pending.delete(msg.id)
          const err = msg.error
          const silgiErr = new SilgiError(err.code ?? 'INTERNAL_SERVER_ERROR', {
            status: err.status,
            message: err.message,
            data: err.data,
          })
          if (pending.kind === 'single') pending.reject(silgiErr)
          else pending.fail(silgiErr)
          return
        }

        // Single response frame
        if ('result' in msg) {
          this.#pending.delete(msg.id)
          if (pending.kind === 'single') pending.resolve(msg.result)
          // If already a stream, ignore — shouldn't happen
          return
        }

        // Stream frames — 'data' key present
        if ('data' in msg) {
          // Terminator
          if (msg.done === true) {
            this.#pending.delete(msg.id)
            if (pending.kind === 'stream') pending.end()
            else {
              // Single with a trailing done and null data → resolve null
              pending.resolve(msg.data)
            }
            return
          }

          // First data frame on a 'single' pending — upgrade to stream
          if (pending.kind === 'single') {
            const { iter, push, end, fail } = createStreamIterator<unknown>()
            const streamPending: PendingStream = { kind: 'stream', push, end, fail }
            this.#pending.set(msg.id, streamPending)
            // Resolve original promise with the iterator
            pending.resolve(iter)
            // Push the first value
            push(msg.data)
            return
          }

          // Continuation
          pending.push(msg.data)
        }
      })

      ws.addEventListener('close', () => {
        this.#ws = undefined
        const err = new SilgiError('INTERNAL_SERVER_ERROR', { message: 'WebSocket closed' })
        for (const [, p] of this.#pending) {
          if (p.kind === 'single') p.reject(err)
          else p.fail(err)
        }
        this.#pending.clear()
      })
    })

    return this.#connecting
  }

  /** Close the WebSocket connection and reject/terminate all pending calls */
  dispose(): void {
    this.#ws?.close()
    const err = new DOMException('Link disposed', 'AbortError')
    for (const [, p] of this.#pending) {
      if (p.kind === 'single') p.reject(err)
      else p.fail(err)
    }
    this.#pending.clear()
  }
}
