/**
 * Analytics SSE — real-time event streaming for the analytics dashboard.
 */

import { encodeEventMessage } from '../core/sse.ts'

import type { ErrorEntry, RequestEntry, TaskExecution } from './analytics.ts'

// ── Event Types ──

export type AnalyticsEvent =
  | { type: 'request'; data: RequestEntry }
  | { type: 'error'; data: ErrorEntry }
  | { type: 'task'; data: TaskExecution }
  | { type: 'stats'; data: unknown }

// ── SSE Hub ──

export class AnalyticsSSEHub {
  #clients = new Set<ReadableStreamDefaultController<string>>()
  #statsInterval: ReturnType<typeof setInterval> | null = null
  #getStats: (() => unknown) | null = null

  constructor() {}

  /** Start periodic stats broadcast. */
  startStatsBroadcast(getStats: () => unknown, intervalMs = 5000): void {
    this.#getStats = getStats
    this.#statsInterval = setInterval(() => {
      if (this.#clients.size > 0 && this.#getStats) {
        this.broadcast({ type: 'stats', data: this.#getStats() })
      }
    }, intervalMs)
    if (typeof this.#statsInterval === 'object' && 'unref' in this.#statsInterval) {
      this.#statsInterval.unref()
    }
  }

  /** Broadcast an event to all connected clients. */
  broadcast(event: AnalyticsEvent): void {
    if (this.#clients.size === 0) return
    const message = encodeEventMessage({
      event: event.type,
      data: JSON.stringify(event.data),
    })
    for (const controller of this.#clients) {
      try {
        controller.enqueue(message)
      } catch {
        this.#clients.delete(controller)
      }
    }
  }

  /** Create an SSE ReadableStream for a new client connection. */
  createStream(): ReadableStream<Uint8Array> {
    let controller: ReadableStreamDefaultController<string>
    let keepAliveTimer: ReturnType<typeof setInterval>

    const textStream = new ReadableStream<string>({
      start: (ctrl) => {
        controller = ctrl
        this.#clients.add(controller)

        // Send initial comment to flush headers
        controller.enqueue(encodeEventMessage({ comment: 'connected' }))

        // Keepalive every 15s
        keepAliveTimer = setInterval(() => {
          try {
            controller.enqueue(encodeEventMessage({ comment: 'keepalive' }))
          } catch {
            clearInterval(keepAliveTimer)
            this.#clients.delete(controller)
          }
        }, 15_000)
        if (typeof keepAliveTimer === 'object' && 'unref' in keepAliveTimer) {
          keepAliveTimer.unref()
        }
      },
      cancel: () => {
        clearInterval(keepAliveTimer)
        this.#clients.delete(controller)
      },
    })

    return textStream.pipeThrough(new TextEncoderStream())
  }

  /** Number of connected clients. */
  get clientCount(): number {
    return this.#clients.size
  }

  dispose(): void {
    if (this.#statsInterval) clearInterval(this.#statsInterval)
    this.#statsInterval = null
    for (const controller of this.#clients) {
      try {
        controller.close()
      } catch {}
    }
    this.#clients.clear()
  }
}
