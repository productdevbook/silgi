/**
 * NATS driver for the Silgi broker adapter.
 *
 * Works with both `nats` (v2) and `@nats-io/transport-node` (v3).
 * Zero external dependencies — the user provides their own NatsConnection.
 *
 * @example
 * ```ts
 * import { connect } from "nats"
 * import { natsBroker } from "silgi/broker/nats"
 * import { createBroker, BrokerLink } from "silgi/broker"
 * import { createClient } from "silgi/client"
 *
 * const nc = await connect({ servers: "localhost:4222" })
 * const driver = natsBroker(nc, { queue: "myapp-workers" })
 *
 * // Server
 * const dispose = await createBroker(appRouter, driver)
 *
 * // Client
 * const client = createClient<AppRouter>(new BrokerLink(driver))
 * ```
 */

import type { BrokerDriver } from './index.ts'

// ── Minimal NATS Interfaces ────────────────────────
// Compatible with `nats` v2 and `@nats-io/transport-node` v3

export interface NatsMsg {
  data: Uint8Array
  respond(payload: Uint8Array): boolean
}

export interface NatsSub {
  unsubscribe(): void
}

export interface NatsConnection {
  subscribe(subject: string, opts?: { callback?: (err: Error | null, msg: NatsMsg) => void; queue?: string }): NatsSub
  request(subject: string, payload?: Uint8Array, opts?: { timeout?: number }): Promise<NatsMsg>
}

// ── Options ─────────────────────────────────────────

export interface NatsBrokerOptions {
  /** Queue group name for load-balanced consumption across instances */
  queue?: string
}

// ── Driver ──────────────────────────────────────────

const encoder = /* @__PURE__ */ new TextEncoder()
const decoder = /* @__PURE__ */ new TextDecoder()

/**
 * Create a NATS broker driver from a NatsConnection.
 *
 * Uses NATS native request-reply for zero-overhead correlation.
 * Supports queue groups for horizontal scaling — only one instance
 * in the group handles each request.
 */
export function natsBroker(nc: NatsConnection, options: NatsBrokerOptions = {}): BrokerDriver {
  return {
    subscribe(subject, handler) {
      const sub = nc.subscribe(subject, {
        queue: options.queue,
        callback: (_err, msg) => {
          handler(decoder.decode(msg.data), (response) => {
            msg.respond(encoder.encode(response))
          })
        },
      })
      return () => sub.unsubscribe()
    },

    async request(subject, payload, opts) {
      const msg = await nc.request(subject, encoder.encode(payload), {
        timeout: opts?.timeout ?? 10_000,
      })
      return decoder.decode(msg.data)
    },
  }
}
