/**
 * Peer-to-peer adapter — bidirectional RPC between two Katman instances.
 *
 * Both sides can be client AND server simultaneously. Uses MessagePort
 * or any bidirectional channel (WebSocket, WebRTC DataChannel, etc.).
 *
 * @example
 * ```ts
 * import { createPeer } from "katman/peer"
 *
 * // Peer A
 * const peerA = createPeer(routerA, channel.port1, {
 *   context: () => ({ role: "A" }),
 * })
 *
 * // Peer A calls Peer B's procedures
 * const result = await peerA.client.someRemoteProcedure({ data: 1 })
 *
 * // Peer B
 * const peerB = createPeer(routerB, channel.port2, {
 *   context: () => ({ role: "B" }),
 * })
 *
 * // Peer B calls Peer A's procedures
 * const result = await peerB.client.someOtherProcedure()
 * ```
 */

import type { RouterDef, InferClient } from "../types.ts";
import { katmanMessagePort, MessagePortLink } from "./message-port.ts";
import { createClient } from "../client/client.ts";

export interface PeerOptions<TCtx extends Record<string, unknown>> {
  context?: () => TCtx | Promise<TCtx>;
}

export interface Peer<TRemoteRouter extends RouterDef> {
  /** Typed client to call the remote peer's procedures */
  client: InferClient<TRemoteRouter>;
  /** Dispose function to stop listening */
  dispose: () => void;
}

/**
 * Create a bidirectional peer — serves your router AND creates a client
 * for the remote peer's router.
 *
 * @param localRouter - Your procedures (served to the remote peer)
 * @param port - Bidirectional message port
 * @param options - Context factory for incoming calls
 */
export function createPeer<
  TLocalRouter extends RouterDef,
  TRemoteRouter extends RouterDef,
>(
  localRouter: TLocalRouter,
  port: {
    postMessage(msg: unknown): void;
    addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
    removeEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
  },
  options: PeerOptions<Record<string, unknown>> = {},
): Peer<TRemoteRouter> {
  // Server side: handle incoming calls
  const dispose = katmanMessagePort(localRouter, port, options);

  // Client side: make outgoing calls
  const link = new MessagePortLink(port);
  const client = createClient<InferClient<TRemoteRouter>>(link);

  return { client, dispose };
}
