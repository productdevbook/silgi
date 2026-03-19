/**
 * Publisher/PubSub — event pub/sub with pluggable backends.
 *
 * Publish events from any procedure, subscribe from SSE/WebSocket.
 * Built-in memory adapter. Redis/Upstash adapters plug in via interface.
 *
 * @example
 * ```ts
 * import { createPublisher, MemoryPubSub } from "katman/plugins"
 *
 * const pubsub = createPublisher(new MemoryPubSub())
 *
 * // Publish from a mutation
 * const createUser = k.mutation(async ({ input, ctx }) => {
 *   const user = await ctx.db.users.create(input)
 *   await pubsub.publish("user:created", user)
 *   return user
 * })
 *
 * // Subscribe via SSE
 * const onUserCreated = k.subscription(async function* () {
 *   yield* pubsub.subscribe("user:created")
 * })
 * ```
 */

// ── PubSub Backend Interface ─────────────────────────

export interface PubSubBackend {
  publish(channel: string, data: unknown): Promise<void>
  subscribe(channel: string, callback: (data: unknown) => void): () => void
}

// ── Memory Backend ───────────────────────────────────

export class MemoryPubSub implements PubSubBackend {
  #listeners = new Map<string, Set<(data: unknown) => void>>()

  async publish(channel: string, data: unknown): Promise<void> {
    const listeners = this.#listeners.get(channel)
    if (!listeners) return
    for (const cb of listeners) cb(data)
  }

  subscribe(channel: string, callback: (data: unknown) => void): () => void {
    let set = this.#listeners.get(channel)
    if (!set) {
      set = new Set()
      this.#listeners.set(channel, set)
    }
    set.add(callback)
    return () => {
      set!.delete(callback)
      if (set!.size === 0) this.#listeners.delete(channel)
    }
  }
}

// ── Publisher ────────────────────────────────────────

export interface Publisher {
  /** Publish an event to a channel */
  publish(channel: string, data: unknown): Promise<void>
  /** Subscribe to a channel — returns an async iterable for use in subscriptions */
  subscribe<T = unknown>(channel: string): AsyncGenerator<T, void, unknown>
}

/**
 * Create a publisher from a PubSub backend.
 *
 * The publisher exposes `publish()` for mutations and `subscribe()`
 * as an async generator for SSE/WebSocket subscriptions.
 */
export function createPublisher(backend: PubSubBackend): Publisher {
  return {
    publish: (channel, data) => backend.publish(channel, data),

    async *subscribe<T = unknown>(channel: string): AsyncGenerator<T, void, unknown> {
      const queue: T[] = []
      let resolve: (() => void) | null = null

      const unsubscribe = backend.subscribe(channel, (data) => {
        queue.push(data as T)
        if (resolve) {
          resolve()
          resolve = null
        }
      })

      try {
        while (true) {
          if (queue.length > 0) {
            yield queue.shift()!
          } else {
            await new Promise<void>((r) => {
              resolve = r
            })
          }
        }
      } finally {
        unsubscribe()
      }
    },
  }
}
