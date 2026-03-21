/**
 * Message Broker adapter — driver-based RPC over any message broker.
 *
 * Pluggable driver pattern (like unstorage) — bring your own broker client.
 * Built-in memory driver for testing. NATS and Redis drivers available separately.
 *
 * @example
 * ```ts
 * // Server
 * import { silgiBroker, memoryBroker } from "silgi/broker"
 *
 * const driver = memoryBroker()
 * const dispose = await silgiBroker(appRouter, driver, {
 *   subject: "myapp.rpc",
 *   context: () => ({ db: getDB() }),
 * })
 *
 * // Client
 * import { BrokerLink } from "silgi/broker"
 * import { createClient } from "silgi/client"
 *
 * const client = createClient<AppRouter>(new BrokerLink(driver, { subject: "myapp.rpc" }))
 * const users = await client.users.list({ limit: 10 })
 * ```
 */

import { compileRouter } from '../compile.ts'
import { SilgiError, toSilgiError } from '../core/error.ts'
import { ValidationError } from '../core/schema.ts'

import type { ClientContext, ClientLink, ClientOptions } from '../client/types.ts'
import type { RouterDef } from '../types.ts'

// ── Driver Interface ────────────────────────────────

/**
 * Universal broker transport — implement this for any message broker.
 *
 * Two methods: `subscribe` (server listens) and `request` (client calls).
 * The driver handles serialization, correlation, and reply routing internally.
 */
export interface BrokerDriver {
  /**
   * Subscribe to a subject. Handler receives a serialized payload and a
   * `reply` callback to send the response back to the caller.
   *
   * Returns a cleanup function (sync or async) to unsubscribe.
   */
  subscribe(
    subject: string,
    handler: (payload: string, reply: (data: string) => void) => void,
  ): (() => void) | Promise<() => void>

  /**
   * Request-reply: publish payload to a subject and wait for the response.
   * The driver handles correlation and reply routing internally.
   */
  request(subject: string, payload: string, opts?: { timeout?: number }): Promise<string>
}

// ── Wire Protocol ───────────────────────────────────

interface BrokerRPCRequest {
  /** Procedure path */
  p: string
  /** Input data */
  i?: unknown
}

interface BrokerRPCResponse {
  /** Result (success) */
  r?: unknown
  /** Error (failure) */
  e?: { code: string; status: number; message: string; data?: unknown }
}

// ── Server ──────────────────────────────────────────

export interface BrokerOptions<TCtx extends Record<string, unknown>> {
  /** Subject/topic to listen on. Default: `"silgi"` */
  subject?: string
  /** Context factory — called per request */
  context?: () => TCtx | Promise<TCtx>
}

/**
 * Attach Silgi to a message broker (server side).
 *
 * Listens for RPC messages on the given subject, dispatches to the compiled
 * router, and replies with results or errors.
 *
 * Returns a cleanup function to stop listening.
 */
export async function silgiBroker<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  driver: BrokerDriver,
  options: BrokerOptions<TCtx> = {},
): Promise<() => void> {
  const compiledRouter = compileRouter(router)
  const subject = options.subject ?? 'silgi'

  const unsubscribe = await driver.subscribe(subject, (payload, reply) => {
    let msg: BrokerRPCRequest
    try {
      msg = JSON.parse(payload)
    } catch {
      const res: BrokerRPCResponse = { e: { code: 'BAD_REQUEST', status: 400, message: 'Invalid payload' } }
      reply(JSON.stringify(res))
      return
    }

    const match = compiledRouter('POST', '/' + msg.p)
    if (!match) {
      const res: BrokerRPCResponse = { e: { code: 'NOT_FOUND', status: 404, message: 'Procedure not found' } }
      reply(JSON.stringify(res))
      return
    }

    const route = match.data

    // Process async, reply via callback
    void (async () => {
      try {
        const ctx: Record<string, unknown> = Object.create(null)
        if (match.params) ctx.params = match.params
        if (options.context) {
          const baseCtx = await options.context()
          const keys = Object.keys(baseCtx)
          for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!]
        }

        const signal = new AbortController().signal
        const result = await route.handler(ctx, msg.i, signal)
        const res: BrokerRPCResponse = { r: result }
        reply(JSON.stringify(res))
      } catch (error) {
        const e =
          error instanceof ValidationError
            ? { code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }
            : error instanceof SilgiError
              ? error.toJSON()
              : toSilgiError(error).toJSON()
        const res: BrokerRPCResponse = { e }
        reply(JSON.stringify(res))
      }
    })()
  })

  return typeof unsubscribe === 'function' ? unsubscribe : () => {}
}

// ── Client Link ─────────────────────────────────────

export interface BrokerLinkOptions {
  /** Subject/topic to send requests to. Default: `"silgi"` */
  subject?: string
  /** Request timeout in ms. Default: `10_000` */
  timeout?: number
}

/**
 * Client-side broker link — sends RPC calls via a broker driver.
 */
export class BrokerLink<TCtx extends ClientContext = ClientContext> implements ClientLink<TCtx> {
  #driver: BrokerDriver
  #subject: string
  #timeout: number

  constructor(driver: BrokerDriver, options: BrokerLinkOptions = {}) {
    this.#driver = driver
    this.#subject = options.subject ?? 'silgi'
    this.#timeout = options.timeout ?? 10_000
  }

  async call(path: readonly string[], input: unknown, _options: ClientOptions<TCtx>): Promise<unknown> {
    const req: BrokerRPCRequest = { p: path.join('/'), i: input }
    const raw = await this.#driver.request(this.#subject, JSON.stringify(req), { timeout: this.#timeout })
    const res: BrokerRPCResponse = JSON.parse(raw)

    if (res.e) {
      throw new SilgiError(res.e.code, {
        status: res.e.status,
        message: res.e.message,
        data: res.e.data,
      })
    }

    return res.r
  }
}

// ── Memory Driver ───────────────────────────────────

/**
 * In-memory broker driver — for testing and single-process development.
 * Simulates request-reply without any external broker.
 */
export function memoryBroker(): BrokerDriver {
  const subscribers = new Map<string, Set<(payload: string, reply: (data: string) => void) => void>>()

  return {
    subscribe(subject, handler) {
      let set = subscribers.get(subject)
      if (!set) {
        set = new Set()
        subscribers.set(subject, set)
      }
      set.add(handler)
      return () => {
        set!.delete(handler)
        if (set!.size === 0) subscribers.delete(subject)
      }
    },

    request(subject, payload, opts) {
      return new Promise((resolve, reject) => {
        const handlers = subscribers.get(subject)
        if (!handlers || handlers.size === 0) {
          reject(new Error(`No subscriber for subject "${subject}"`))
          return
        }

        const timeout = opts?.timeout ?? 10_000
        const timer = setTimeout(() => reject(new Error(`Broker request timeout: ${subject}`)), timeout)

        // Deliver to first subscriber (single consumer semantics)
        const handler = handlers.values().next().value!
        handler(payload, (response) => {
          clearTimeout(timer)
          resolve(response)
        })
      })
    },
  }
}
