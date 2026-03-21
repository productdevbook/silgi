/**
 * Redis driver for the Silgi broker adapter.
 *
 * Simulates request-reply over Redis Pub/Sub using temporary inbox channels.
 * Works with any Redis client via the RedisTransport interface.
 *
 * @example
 * ```ts
 * import Redis from "ioredis"
 * import { redisBroker, ioredisTransport } from "silgi/broker/redis"
 * import { silgiBroker, BrokerLink } from "silgi/broker"
 * import { createClient } from "silgi/client"
 *
 * const redis = new Redis()
 * const transport = ioredisTransport(redis, redis.duplicate())
 * const driver = redisBroker(transport)
 *
 * // Server
 * const dispose = await silgiBroker(appRouter, driver)
 *
 * // Client
 * const client = createClient<AppRouter>(new BrokerLink(driver))
 * ```
 */

import type { BrokerDriver } from './index.ts'

// ── Redis Transport Interface ───────────────────────

/**
 * Minimal pub/sub transport — implement this for your Redis client.
 *
 * `subscribe` returns a cleanup function to unsubscribe.
 * Both sync and async returns are supported.
 */
export interface RedisTransport {
  publish(channel: string, message: string): unknown
  subscribe(channel: string, handler: (message: string) => void): (() => void) | Promise<() => void>
}

// ── ioredis Helper ──────────────────────────────────

/**
 * Minimal ioredis-compatible interface.
 * Works with `ioredis` and any client that matches this shape.
 */
export interface IORedisLike {
  publish(channel: string, message: string): Promise<number>
  subscribe(...channels: string[]): Promise<unknown>
  unsubscribe(...channels: string[]): Promise<unknown>
  on(event: 'message', listener: (channel: string, message: string) => void): void
}

/**
 * Create a RedisTransport from two ioredis connections.
 *
 * Redis requires separate connections for publishing and subscribing
 * because `SUBSCRIBE` puts the connection into subscriber mode.
 *
 * @param pub - Publisher connection (regular Redis client)
 * @param sub - Subscriber connection (dedicated for SUBSCRIBE)
 */
export function ioredisTransport(pub: IORedisLike, sub: IORedisLike): RedisTransport {
  const handlers = new Map<string, Set<(msg: string) => void>>()

  sub.on('message', (channel: string, message: string) => {
    const set = handlers.get(channel)
    if (set) for (const handler of set) handler(message)
  })

  return {
    publish(channel, message) {
      return pub.publish(channel, message)
    },

    async subscribe(channel, handler) {
      let set = handlers.get(channel)
      if (!set) {
        set = new Set()
        handlers.set(channel, set)
        await sub.subscribe(channel)
      }
      set.add(handler)
      return () => {
        set!.delete(handler)
        if (set!.size === 0) {
          handlers.delete(channel)
          sub.unsubscribe(channel)
        }
      }
    },
  }
}

// ── Options ─────────────────────────────────────────

export interface RedisBrokerOptions {
  /** Unique prefix for inbox channels. Auto-generated if not provided. */
  inbox?: string
}

// ── Driver ──────────────────────────────────────────

let globalSeq = 0

/**
 * Create a Redis broker driver from a RedisTransport.
 *
 * Simulates request-reply using temporary inbox channels:
 * 1. Client subscribes to a unique inbox channel
 * 2. Client publishes request with inbox address embedded
 * 3. Server processes request, publishes response to inbox
 * 4. Client receives response, unsubscribes from inbox
 *
 * Wire format: `"inbox-channel\npayload"` (newline separator, no double-serialization)
 */
export function redisBroker(transport: RedisTransport, options: RedisBrokerOptions = {}): BrokerDriver {
  const inboxPrefix = options.inbox ?? `silgi:inbox:${Date.now().toString(36)}:${(++globalSeq).toString(36)}`
  let requestSeq = 0

  return {
    async subscribe(subject, handler) {
      return transport.subscribe(subject, (message) => {
        // Wire format: "replyTo\npayload"
        const sep = message.indexOf('\n')
        if (sep === -1) return
        const replyTo = message.slice(0, sep)
        const payload = message.slice(sep + 1)

        handler(payload, (response) => {
          transport.publish(replyTo, response)
        })
      })
    },

    async request(subject, payload, opts) {
      const inbox = `${inboxPrefix}:${++requestSeq}`
      const timeout = opts?.timeout ?? 10_000
      const { promise, resolve, reject } = Promise.withResolvers<string>()

      let cleanup: (() => void) | undefined
      const timer = setTimeout(() => {
        cleanup?.()
        reject(new Error(`Broker request timeout: ${subject}`))
      }, timeout)

      try {
        // Subscribe to inbox BEFORE publishing — prevents race condition
        const unsub = await transport.subscribe(inbox, (message) => {
          clearTimeout(timer)
          cleanup?.()
          resolve(message)
        })
        cleanup = typeof unsub === 'function' ? unsub : undefined

        // Publish request with reply-to address (newline-separated, no double-JSON)
        await transport.publish(subject, inbox + '\n' + payload)
      } catch (err) {
        clearTimeout(timer)
        cleanup?.()
        reject(err)
      }

      return promise
    },
  }
}
