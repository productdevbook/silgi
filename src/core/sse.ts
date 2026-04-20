/**
 * Server-Sent Events
 * -------------------
 *
 * silgi subscriptions are yielded to the client as an SSE event stream.
 * This module holds the encoder, the streaming decoder (for client-side
 * consumption), and the iterator ↔ stream bridges in both directions.
 *
 * Wire vocabulary
 * ---------------
 *
 *   `event: message`  → one yielded value
 *   `event: error`    → resolver threw (sanitized for undefined errors)
 *   `event: done`     → generator returned; `data` is the return value
 *   `: <comment>`     → keepalive or boot marker; ignored by clients
 *
 * Event metadata (SSE `id` / `retry`) can be attached to any object
 * value via `withEventMeta()` and round-trips through the decoder.
 */

import { SilgiError } from './error.ts'
import { AsyncIteratorClass } from './iterator.ts'

// ─── Event metadata side channel ──────────────────────────────────────

export interface EventMeta {
  id?: string
  retry?: number
}

/**
 * Metadata store for SSE `id` / `retry` fields.
 *
 * This `WeakMap` is module-scoped (i.e. shared across every subscription
 * in the process). That is safe: entries are keyed by the *value object*
 * the user passes in, and GC reclaims entries as soon as those objects
 * become unreachable. A per-iterator store would add plumbing for
 * nothing — two subscriptions yielding distinct objects never collide.
 */
const metaStore = new WeakMap<object, EventMeta>()

/**
 * Attach SSE `id` / `retry` metadata to a yielded value.
 *
 * Only object-shaped values can carry metadata; primitives cannot be
 * keyed in the `WeakMap` and are returned unchanged. Wrap primitives
 * in a one-field object when you need metadata on them.
 */
export function withEventMeta<T>(value: T, meta: EventMeta): T {
  if (typeof value === 'object' && value !== null) {
    metaStore.set(value as object, meta)
  }
  return value
}

/** Read SSE metadata previously attached via `withEventMeta`. */
export function getEventMeta(value: unknown): EventMeta | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  return metaStore.get(value as object)
}

// ─── Wire format ──────────────────────────────────────────────────────

export interface EventMessage {
  event?: string
  data?: string
  id?: string
  retry?: number
  comment?: string
}

/**
 * Serialize an `EventMessage` into SSE wire format (one event terminated
 * by a blank line). Multi-line `data` and `comment` are split across
 * multiple fields per the SSE spec so embedded newlines survive.
 */
export function encodeEventMessage(msg: EventMessage): string {
  const lines: string[] = []

  if (msg.comment !== undefined) {
    for (const line of msg.comment.split('\n')) lines.push(`: ${line}`)
  }
  if (msg.event !== undefined) lines.push(`event: ${msg.event}`)
  if (msg.id !== undefined) lines.push(`id: ${msg.id}`)
  if (msg.retry !== undefined) lines.push(`retry: ${msg.retry}`)
  if (msg.data !== undefined) {
    for (const line of msg.data.split('\n')) lines.push(`data: ${line}`)
  }

  return lines.join('\n') + '\n\n'
}

// ─── Streaming decoder ────────────────────────────────────────────────

/**
 * Incremental SSE decoder for chunked text input.
 *
 * Feed it text as it arrives from the network; it emits a full
 * `EventMessage` through the `onEvent` callback once it has seen a
 * blank-line terminator. The trailing partial event (if any) is held
 * over until the next `feed()` call — or flushed explicitly on stream
 * end via `flush()`.
 */
export class EventDecoder {
  #partial = ''
  #onEvent: (msg: EventMessage) => void

  constructor(onEvent: (msg: EventMessage) => void) {
    this.#onEvent = onEvent
  }

  feed(chunk: string): void {
    this.#partial += chunk
    const blocks = this.#partial.split('\n\n')
    // Whatever is after the last `\n\n` is still mid-event; save it.
    this.#partial = blocks.pop() ?? ''

    for (const block of blocks) {
      if (!block.trim()) continue
      const msg = this.#parseBlock(block)
      if (msg) this.#onEvent(msg)
    }
  }

  /** Parse any remaining partial block. Call once at end-of-stream. */
  flush(): void {
    if (this.#partial.trim()) {
      const msg = this.#parseBlock(this.#partial)
      if (msg) this.#onEvent(msg)
      this.#partial = ''
    }
  }

  #parseBlock(block: string): EventMessage | null {
    const msg: EventMessage = {}
    let hasContent = false

    for (const line of block.split('\n')) {
      // Lines starting with `:` are comments (keepalives, boot markers).
      if (line.startsWith(':')) {
        msg.comment = (msg.comment ? msg.comment + '\n' : '') + line.slice(2)
        hasContent = true
        continue
      }

      const colon = line.indexOf(':')
      if (colon === -1) continue

      const field = line.slice(0, colon)
      const value = line.slice(colon + 1).trimStart()

      switch (field) {
        case 'event':
          msg.event = value
          hasContent = true
          break
        case 'data':
          // Per the SSE spec, multiple `data:` lines within one event
          // are concatenated with `\n` between them.
          msg.data = (msg.data ? msg.data + '\n' : '') + value
          hasContent = true
          break
        case 'id':
          msg.id = value
          hasContent = true
          break
        case 'retry':
          msg.retry = parseInt(value, 10)
          hasContent = true
          break
      }
    }

    return hasContent ? msg : null
  }
}

// ─── Iterator → SSE stream ────────────────────────────────────────────

/**
 * Build an SSE `ReadableStream` that consumes an async iterator.
 *
 * Each yielded value becomes a `message` event; the iterator's return
 * value becomes the `done` event; a thrown error becomes an `error`
 * event (and only the message is exposed when the error is not a
 * `SilgiError` flagged `defined` — undefined errors must not leak
 * internals).
 *
 * A comment-only `keepalive` event is emitted every `keepAliveMs` so
 * intermediaries (proxies, load balancers) do not close the connection
 * while the resolver is quiet.
 */
export function iteratorToEventStream(
  iterator: AsyncIterableIterator<unknown>,
  options: {
    serialize?: (value: unknown) => string
    keepAliveMs?: number
    initialComment?: string
  } = {},
): ReadableStream<Uint8Array> {
  const serialize = options.serialize ?? JSON.stringify
  const keepAliveMs = options.keepAliveMs ?? 30_000

  let keepAliveTimer: ReturnType<typeof setInterval> | undefined
  let cancelled = false

  /** Build the wire form of one yielded value, carrying any attached meta. */
  const encodeValue = (value: unknown): string => {
    const meta = getEventMeta(value)
    return encodeEventMessage({
      event: 'message',
      data: serialize(value),
      id: meta?.id,
      retry: meta?.retry,
    })
  }

  /** Build the wire form of the terminal `done` event, if a return value was yielded. */
  const encodeDone = (value: unknown): string => {
    const data = value !== undefined ? serialize(value) : undefined
    return encodeEventMessage({ event: 'done', data })
  }

  /**
   * Build the wire form of an `error` event.
   *
   * Only `SilgiError` with `defined === true` surfaces its `code` and
   * `message` to the wire — the author opted into publishing those by
   * declaring the error. Everything else collapses to a generic 500
   * shape so we do not leak stack traces or internal codes.
   */
  const encodeError = (err: unknown): string => {
    const data =
      err instanceof SilgiError && err.defined
        ? JSON.stringify({ message: err.message, code: err.code })
        : JSON.stringify({ message: 'Internal server error', code: 'INTERNAL_SERVER_ERROR' })
    return encodeEventMessage({ event: 'error', data })
  }

  const textStream = new ReadableStream<string>({
    start(controller) {
      // Flush headers immediately: clients waiting on the first byte
      // (including the browser's EventSource) stall until something
      // arrives, and a boot comment is the cheapest thing to send.
      if (options.initialComment !== undefined) {
        controller.enqueue(encodeEventMessage({ comment: options.initialComment }))
      }
      keepAliveTimer = setInterval(() => {
        if (!cancelled) controller.enqueue(encodeEventMessage({ comment: 'keepalive' }))
      }, keepAliveMs)
    },

    async pull(controller) {
      try {
        const result = await iterator.next()
        if (cancelled) return

        if (result.done) {
          clearInterval(keepAliveTimer)
          controller.enqueue(encodeDone(result.value))
          controller.close()
          return
        }

        controller.enqueue(encodeValue(result.value))
      } catch (error) {
        clearInterval(keepAliveTimer)
        if (cancelled) return
        controller.enqueue(encodeError(error))
        controller.close()
      }
    },

    async cancel() {
      cancelled = true
      clearInterval(keepAliveTimer)
      await iterator.return?.()
    },
  })

  return textStream.pipeThrough(new TextEncoderStream())
}

// ─── SSE stream → iterator ────────────────────────────────────────────

/**
 * Turn an SSE `ReadableStream` back into an async iterator.
 *
 *   `message` events → yielded values (deserialized)
 *   `error`   events → thrown exceptions
 *   `done`    event  → normal iterator completion
 *
 * The decoder runs on its own microtask loop, buffering decoded events
 * into a queue that `next()` drains. The queue is needed because the
 * network read loop and the consumer run at different cadences.
 */
export function eventStreamToIterator<T = unknown>(
  stream: ReadableStream<Uint8Array>,
  options: {
    deserialize?: (data: string) => T
  } = {},
): AsyncIteratorClass<T> {
  const deserialize = options.deserialize ?? ((d: string) => JSON.parse(d) as T)
  const decodedStream = stream.pipeThrough(new TextDecoderStream() as any)
  const reader = decodedStream.getReader()

  const events: EventMessage[] = []
  let wakeUp: (() => void) | undefined
  let done = false
  let error: Error | undefined

  const decoder = new EventDecoder((msg) => {
    events.push(msg)
    wakeUp?.()
    wakeUp = undefined
  })

  /** Background reader — drains `stream` into `decoder` until end/err. */
  const readLoop = async (): Promise<void> => {
    try {
      while (true) {
        const { done: readerDone, value } = await reader.read()
        if (readerDone) {
          decoder.flush()
          done = true
          wakeUp?.()
          return
        }
        decoder.feed(value as string)
      }
    } catch (err) {
      done = true
      error = err instanceof Error ? err : new Error(String(err))
      wakeUp?.()
    }
  }

  void readLoop()

  /** Wait until either a new event lands or the stream ends. */
  const waitForEvent = (): Promise<void> =>
    new Promise<void>((resolve) => {
      wakeUp = resolve
    })

  /** Translate one decoded `EventMessage` into an iterator step. */
  const interpret = (msg: EventMessage): IteratorResult<T, void> | 'skip' => {
    switch (msg.event) {
      case 'message': {
        const value = msg.data ? deserialize(msg.data) : (undefined as T)
        const withMeta =
          msg.id || msg.retry ? (withEventMeta(value as any, { id: msg.id, retry: msg.retry }) as T) : value
        return { done: false, value: withMeta }
      }
      case 'error': {
        const payload = msg.data ? JSON.parse(msg.data) : {}
        throw new Error(payload.message ?? 'Stream error')
      }
      case 'done': {
        return { done: true, value: undefined }
      }
      default:
        return 'skip'
    }
  }

  return new AsyncIteratorClass<T>(
    async () => {
      while (true) {
        if (events.length > 0) {
          const step = interpret(events.shift()!)
          if (step !== 'skip') return step
          continue
        }
        if (done) {
          if (error) throw error
          return { done: true, value: undefined }
        }
        await waitForEvent()
      }
    },
    async () => {
      try {
        await decodedStream.cancel()
      } catch {}
      try {
        reader.releaseLock()
      } catch {}
    },
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────

/** Returns `true` when the given headers identify an SSE response. */
export function isEventStreamHeaders(headers: Record<string, string | string[] | undefined>): boolean {
  const ct = headers['content-type']
  if (typeof ct === 'string') return ct.includes('text/event-stream')
  if (Array.isArray(ct)) return ct.some((v) => v.includes('text/event-stream'))
  return false
}
