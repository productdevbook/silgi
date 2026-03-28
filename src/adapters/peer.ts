/**
 * Peer-to-peer adapter — bidirectional RPC between two Silgi instances.
 *
 * Both sides can be client AND server simultaneously. Uses MessagePort
 * or any bidirectional channel (WebSocket, WebRTC DataChannel, etc.).
 *
 * @example
 * ```ts
 * import { createPeer } from "silgi/peer"
 *
 * const peerA = createPeer(routerA, channel.port1)
 * const peerB = createPeer(routerB, channel.port2)
 *
 * // A calls B's procedures
 * const result = await peerA.client.hello()
 *
 * // B calls A's procedures
 * const result = await peerB.client.ping()
 * ```
 */

import { createClient } from '../client/client.ts'

import { createHandler, MessagePortLink } from './message-port.ts'

import type { RouterDef } from '../types.ts'

export interface PeerOptions<TCtx extends Record<string, unknown>> {
  context?: () => TCtx | Promise<TCtx>
}

export interface Peer {
  /** Client proxy to call the remote peer's procedures */
  client: any
  /** Stop listening for incoming calls */
  dispose: () => void
}

/**
 * Create a bidirectional peer — serves your router AND creates a client
 * for the remote peer's router.
 */
export function createPeer(
  localRouter: RouterDef,
  port: {
    postMessage(msg: unknown): void
    addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void
    removeEventListener(type: 'message', handler: (event: { data: unknown }) => void): void
  },
  options: PeerOptions<Record<string, unknown>> = {},
): Peer {
  const dispose = createHandler(localRouter, port, options)
  const link = new MessagePortLink(port)
  const client = createClient(link)

  return { client, dispose }
}
