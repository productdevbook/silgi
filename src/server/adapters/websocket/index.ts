/**
 * WebSocket adapter — bidirectional RPC over WebSocket.
 *
 * Protocol:
 * - Client sends: { id, path, input }
 * - Server responds: { id, output } or { id, error }
 * - For SSE/streaming: server sends { id, event: "message"|"done"|"error", data }
 * - Client can send { id, type: "abort" } to cancel
 *
 * Uses a minimal framing protocol instead of HTTP overhead.
 */

import type { Context } from "../../../core/types.ts";
import type { AnyRouter } from "../../router.ts";
import type { AnyProcedure } from "../../procedure.ts";
import { isProcedure } from "../../procedure.ts";
import { isLazy, unlazy } from "../../lazy.ts";
import { compilePipeline } from "../../../core/pipeline.ts";
import { validateSchema } from "../../../core/schema.ts";
import { createErrorConstructorMap } from "../../error.ts";
import { toKatmanError, KatmanError } from "../../../core/error.ts";
import { ValidationError } from "../../../core/schema.ts";

// === Message Types ===

interface RequestMessage {
  id: string;
  path: string[];
  input?: unknown;
}

interface AbortMessage {
  id: string;
  type: "abort";
}

type IncomingMessage = RequestMessage | AbortMessage;

interface ResponseMessage {
  id: string;
  output?: unknown;
  error?: { code: string; status: number; message: string; data?: unknown };
}

interface StreamEventMessage {
  id: string;
  event: "message" | "done" | "error";
  data?: unknown;
}

// === Minimal WebSocket interface ===

export interface MinimalWebSocket {
  send(data: string): void;
  addEventListener(event: "message", listener: (ev: { data: string | ArrayBuffer }) => void): void;
  addEventListener(event: "close", listener: () => void): void;
  addEventListener(event: "error", listener: (ev: unknown) => void): void;
  removeEventListener?(event: string, listener: Function): void;
}

// === WebSocket Handler ===

export interface WebSocketHandlerOptions<TContext extends Context = Context> {
  /** Context factory — called per connection or per message */
  context: TContext | ((ws: MinimalWebSocket) => TContext);
}

export class WebSocketHandler<TContext extends Context = Context> {
  #router: AnyRouter;
  #contextFactory: (ws: MinimalWebSocket) => TContext;
  #pipelineCache = new WeakMap<AnyProcedure, ReturnType<typeof compilePipeline>>();
  #activeRequests = new WeakMap<MinimalWebSocket, Map<string, AbortController>>();

  constructor(router: AnyRouter, options: WebSocketHandlerOptions<TContext>) {
    this.#router = router;
    this.#contextFactory = typeof options.context === "function"
      ? options.context as (ws: MinimalWebSocket) => TContext
      : () => options.context as TContext;
  }

  /**
   * Handle a new WebSocket connection.
   * Call this when a WebSocket is accepted.
   */
  handleConnection(ws: MinimalWebSocket): void {
    const requests = new Map<string, AbortController>();
    this.#activeRequests.set(ws, requests);

    ws.addEventListener("message", (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        ws.send(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Invalid JSON" } }));
        return;
      }

      if ("type" in msg && msg.type === "abort") {
        const controller = requests.get(msg.id);
        if (controller) {
          controller.abort();
          requests.delete(msg.id);
        }
        return;
      }

      void this.#handleRequest(ws, msg as RequestMessage, requests);
    });

    ws.addEventListener("close", () => {
      // Abort all pending requests
      for (const controller of requests.values()) {
        controller.abort();
      }
      requests.clear();
    });
  }

  async #handleRequest(
    ws: MinimalWebSocket,
    msg: RequestMessage,
    requests: Map<string, AbortController>,
  ): Promise<void> {
    const controller = new AbortController();
    requests.set(msg.id, controller);

    try {
      const context = this.#contextFactory(ws);
      const procedure = await this.#findProcedure(this.#router, msg.path);

      if (!procedure) {
        this.#send(ws, {
          id: msg.id,
          error: { code: "NOT_FOUND", status: 404, message: "Procedure not found" },
        });
        return;
      }

      // Get or compile pipeline
      let pipeline = this.#pipelineCache.get(procedure);
      if (!pipeline) {
        const def = procedure["~katman"];
        pipeline = compilePipeline(
          def.middlewares,
          def.handler,
          def.inputSchema ? (v: unknown) => validateSchema(def.inputSchema!, v) : undefined,
          def.outputSchema ? (v: unknown) => validateSchema(def.outputSchema!, v) : undefined,
          { inputValidationIndex: def.inputValidationIndex, outputValidationIndex: def.outputValidationIndex },
        );
        this.#pipelineCache.set(procedure, pipeline);
      }

      const errors = createErrorConstructorMap(procedure["~katman"].errorMap);
      const output = await pipeline(
        context,
        msg.input,
        controller.signal,
        msg.path,
        procedure["~katman"].meta,
        errors,
      );

      // Check if output is an async iterator (streaming)
      if (output && typeof output === "object" && Symbol.asyncIterator in (output as object)) {
        await this.#streamResponse(ws, msg.id, output as AsyncIterableIterator<unknown>, controller);
        return;
      }

      // Regular response
      this.#send(ws, { id: msg.id, output });
    } catch (error) {
      if (error instanceof ValidationError) {
        this.#send(ws, {
          id: msg.id,
          error: { code: "BAD_REQUEST", status: 400, message: error.message, data: { issues: error.issues } },
        });
      } else {
        const e = toKatmanError(error);
        this.#send(ws, { id: msg.id, error: e.toJSON() });
      }
    } finally {
      requests.delete(msg.id);
    }
  }

  async #streamResponse(
    ws: MinimalWebSocket,
    id: string,
    iterator: AsyncIterableIterator<unknown>,
    controller: AbortController,
  ): Promise<void> {
    try {
      while (!controller.signal.aborted) {
        const result = await iterator.next();
        if (controller.signal.aborted) break;

        if (result.done) {
          this.#send(ws, { id, event: "done", data: result.value } as StreamEventMessage);
          return;
        }

        this.#send(ws, { id, event: "message", data: result.value } as StreamEventMessage);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        const e = toKatmanError(error);
        this.#send(ws, { id, event: "error", data: e.toJSON() } as StreamEventMessage);
      }
    } finally {
      await iterator.return?.();
    }
  }

  #send(ws: MinimalWebSocket, msg: ResponseMessage | StreamEventMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // WebSocket may be closed
    }
  }

  async #findProcedure(router: AnyRouter, path: string[]): Promise<AnyProcedure | undefined> {
    let current: unknown = router;
    if (isLazy(current)) current = (await unlazy(current)).default;
    if (isProcedure(current)) return path.length === 0 ? current : undefined;
    if (path.length === 0) return undefined;
    const [head, ...tail] = path;
    const child = (current as Record<string, unknown>)[head!];
    if (!child) return undefined;
    const resolved = isLazy(child) ? (await unlazy(child)).default : child;
    return this.#findProcedure(resolved as AnyRouter, tail);
  }
}
