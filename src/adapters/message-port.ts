/**
 * Message Port adapter — use Katman over MessagePort/MessageChannel.
 *
 * Works with Electron (main↔renderer), browser extensions (background↔popup),
 * Web Workers, and Node.js Worker Threads.
 *
 * @example
 * ```ts
 * // Worker / Electron main
 * import { katmanMessagePort } from "katman/message-port"
 *
 * const dispose = katmanMessagePort(appRouter, port, {
 *   context: () => ({ db: getDB() }),
 * })
 *
 * // Client side
 * import { MessagePortLink } from "katman/message-port"
 * import { createClient } from "katman/client"
 *
 * const client = createClient<AppRouter>(new MessagePortLink(port))
 * const users = await client.users.list({ limit: 10 })
 * ```
 */

import type { RouterDef } from "../types.ts";
import type { ClientLink, ClientOptions, ClientContext } from "../client/types.ts";
import { compileRouter } from "../compile.ts";
import { KatmanError, toKatmanError } from "../core/error.ts";
import { ValidationError } from "../core/schema.ts";

export interface MessagePortAdapterOptions<TCtx extends Record<string, unknown>> {
  context?: () => TCtx | Promise<TCtx>;
}

interface RPCMessage {
  __katman: true;
  __type: "request";
  id: string;
  path: string;
  input?: unknown;
}

interface RPCResponse {
  __katman: true;
  __type: "response";
  id: string;
  result?: unknown;
  error?: { code: string; status: number; message: string; data?: unknown };
}

/**
 * Attach Katman to a MessagePort (server side).
 * Listens for RPC messages and responds with results.
 * Returns a dispose function to stop listening.
 */
export function katmanMessagePort<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  port: { postMessage(msg: unknown): void; addEventListener(type: "message", handler: (event: { data: unknown }) => void): void; removeEventListener(type: "message", handler: (event: { data: unknown }) => void): void },
  options: MessagePortAdapterOptions<TCtx> = {},
): () => void {
  const flatRouter = compileRouter(router);
  const signal = new AbortController().signal;

  const handler = async (event: { data: unknown }) => {
    const msg = event.data as RPCMessage;
    if (!msg || typeof msg !== "object" || !msg.__katman || msg.__type !== "request") return;

    const route = flatRouter.get(msg.path);
    if (!route) {
      port.postMessage({
        __katman: true,
        __type: "response",
        id: msg.id,
        error: { code: "NOT_FOUND", status: 404, message: `Procedure not found: ${msg.path}` },
      } satisfies RPCResponse);
      return;
    }

    try {
      const ctx: Record<string, unknown> = Object.create(null);
      if (options.context) {
        const baseCtx = await options.context();
        const keys = Object.keys(baseCtx);
        for (let i = 0; i < keys.length; i++) ctx[keys[i]!] = baseCtx[keys[i]!];
      }

      const result = await route.handler(ctx, msg.input, signal);
      port.postMessage({ __katman: true, __type: "response", id: msg.id, result } satisfies RPCResponse);
    } catch (error) {
      const e = error instanceof ValidationError
        ? { code: "BAD_REQUEST", status: 400, message: error.message, data: { issues: error.issues } }
        : error instanceof KatmanError
          ? error.toJSON()
          : toKatmanError(error).toJSON();
      port.postMessage({ __katman: true, __type: "response", id: msg.id, error: e } satisfies RPCResponse);
    }
  };

  port.addEventListener("message", handler);
  return () => port.removeEventListener("message", handler);
}

/**
 * Client-side MessagePort link.
 * Sends RPC messages and resolves promises when responses arrive.
 */
export class MessagePortLink<TCtx extends ClientContext = ClientContext>
  implements ClientLink<TCtx> {
  #port: { postMessage(msg: unknown): void; addEventListener(type: "message", handler: (event: { data: unknown }) => void): void };
  #pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  #nextId = 1;

  constructor(port: { postMessage(msg: unknown): void; addEventListener(type: "message", handler: (event: { data: unknown }) => void): void }) {
    this.#port = port;
    port.addEventListener("message", (event: { data: unknown }) => {
      const msg = event.data as RPCResponse;
      if (!msg || typeof msg !== "object" || !msg.__katman || msg.__type !== "response") return;
      const pending = this.#pending.get(msg.id);
      if (!pending) return;
      this.#pending.delete(msg.id);
      if (msg.error) {
        pending.reject(new KatmanError(msg.error.code, {
          status: msg.error.status,
          message: msg.error.message,
          data: msg.error.data,
        }));
      } else {
        pending.resolve(msg.result);
      }
    });
  }

  call(path: readonly string[], input: unknown, _options: ClientOptions<TCtx>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = String(this.#nextId++);
      this.#pending.set(id, { resolve, reject });
      this.#port.postMessage({
        __katman: true,
        __type: "request",
        id,
        path: path.join("/"),
        input,
      } satisfies RPCMessage);
    });
  }
}
