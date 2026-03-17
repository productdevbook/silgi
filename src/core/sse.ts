/**
 * Server-Sent Events (SSE) encoding/decoding.
 *
 * Supports three event types:
 * - message: a yielded value
 * - error: an error event with data
 * - done: the return value (stream complete)
 *
 * Event metadata (id, retry) can be attached to values
 * transparently via a Proxy-based symbol injection.
 */

import { AsyncIteratorClass } from "./iterator.ts";

// === Event Metadata ===

const EVENT_META_SYMBOL = Symbol.for("katman.event.meta");

export interface EventMeta {
  id?: string;
  retry?: number;
}

/**
 * Attach SSE metadata (id, retry) to a value transparently.
 * Uses a Proxy so normal property access is unaffected.
 */
export function withEventMeta<T>(value: T, meta: EventMeta): T {
  if (typeof value !== "object" || value === null) return value;
  return new Proxy(value, {
    get(target, prop, receiver) {
      if (prop === EVENT_META_SYMBOL) return meta;
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}

/**
 * Read SSE metadata from a value.
 */
export function getEventMeta(value: unknown): EventMeta | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  return (value as Record<symbol, EventMeta>)[EVENT_META_SYMBOL];
}

// === SSE Message Types ===

export interface EventMessage {
  event?: string;
  data?: string;
  id?: string;
  retry?: number;
  comment?: string;
}

// === SSE Encoder ===

/**
 * Encode an EventMessage into SSE wire format.
 */
export function encodeEventMessage(msg: EventMessage): string {
  const lines: string[] = [];

  if (msg.comment !== undefined) {
    for (const line of msg.comment.split("\n")) {
      lines.push(`: ${line}`);
    }
  }

  if (msg.event !== undefined) {
    lines.push(`event: ${msg.event}`);
  }

  if (msg.id !== undefined) {
    lines.push(`id: ${msg.id}`);
  }

  if (msg.retry !== undefined) {
    lines.push(`retry: ${msg.retry}`);
  }

  if (msg.data !== undefined) {
    for (const line of msg.data.split("\n")) {
      lines.push(`data: ${line}`);
    }
  }

  return lines.join("\n") + "\n\n";
}

// === SSE Decoder (Streaming) ===

/**
 * Stateful SSE decoder for streaming text.
 */
export class EventDecoder {
  #incomplete = "";
  #onEvent: (msg: EventMessage) => void;

  constructor(onEvent: (msg: EventMessage) => void) {
    this.#onEvent = onEvent;
  }

  feed(chunk: string): void {
    this.#incomplete += chunk;
    const blocks = this.#incomplete.split("\n\n");
    // Last block may be incomplete
    this.#incomplete = blocks.pop() ?? "";

    for (const block of blocks) {
      if (!block.trim()) continue;
      const msg = this.#parseBlock(block);
      if (msg) this.#onEvent(msg);
    }
  }

  flush(): void {
    if (this.#incomplete.trim()) {
      const msg = this.#parseBlock(this.#incomplete);
      if (msg) this.#onEvent(msg);
      this.#incomplete = "";
    }
  }

  #parseBlock(block: string): EventMessage | null {
    const msg: EventMessage = {};
    let hasContent = false;

    for (const line of block.split("\n")) {
      if (line.startsWith(":")) {
        msg.comment = (msg.comment ? msg.comment + "\n" : "") + line.slice(2);
        hasContent = true;
        continue;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const field = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1).trimStart();

      switch (field) {
        case "event":
          msg.event = value;
          hasContent = true;
          break;
        case "data":
          msg.data = (msg.data ? msg.data + "\n" : "") + value;
          hasContent = true;
          break;
        case "id":
          msg.id = value;
          hasContent = true;
          break;
        case "retry":
          msg.retry = parseInt(value, 10);
          hasContent = true;
          break;
      }
    }

    return hasContent ? msg : null;
  }
}

// === Iterator ↔ SSE Stream Conversion ===

/**
 * Convert an async iterator to an SSE ReadableStream.
 * Each yielded value becomes a "message" event.
 * Errors become "error" events. Return value becomes "done".
 */
export function iteratorToEventStream(
  iterator: AsyncIterableIterator<unknown>,
  options: {
    serialize?: (value: unknown) => string;
    keepAliveMs?: number;
    initialComment?: string;
  } = {},
): ReadableStream<Uint8Array> {
  const serialize = options.serialize ?? JSON.stringify;
  const keepAliveMs = options.keepAliveMs ?? 30_000;
  const encoder = new TextEncoder();

  let keepAliveTimer: ReturnType<typeof setInterval> | undefined;
  let cancelled = false;

  const textStream = new ReadableStream<string>({
    start(controller) {
      // Flush headers immediately with a comment
      if (options.initialComment !== undefined) {
        controller.enqueue(encodeEventMessage({ comment: options.initialComment }));
      }
    },

    async pull(controller) {
      // Set up keepalive
      clearInterval(keepAliveTimer);
      keepAliveTimer = setInterval(() => {
        if (!cancelled) controller.enqueue(encodeEventMessage({ comment: "keepalive" }));
      }, keepAliveMs);

      try {
        const result = await iterator.next();
        clearInterval(keepAliveTimer);

        if (cancelled) return;

        if (result.done) {
          // Stream complete — send done event
          const data = result.value !== undefined ? serialize(result.value) : undefined;
          controller.enqueue(encodeEventMessage({ event: "done", data }));
          controller.close();
          return;
        }

        // Regular value — send message event
        const meta = getEventMeta(result.value);
        const msg: EventMessage = {
          event: "message",
          data: serialize(result.value),
          id: meta?.id,
          retry: meta?.retry,
        };
        controller.enqueue(encodeEventMessage(msg));
      } catch (error) {
        clearInterval(keepAliveTimer);
        if (cancelled) return;

        // Send error event
        const errorData = error instanceof Error
          ? JSON.stringify({ message: error.message, code: (error as any).code })
          : JSON.stringify({ message: String(error) });

        controller.enqueue(encodeEventMessage({ event: "error", data: errorData }));
        controller.close();
      }
    },

    cancel() {
      cancelled = true;
      clearInterval(keepAliveTimer);
      iterator.return?.();
    },
  });

  // Pipe through text encoder
  return textStream.pipeThrough(new TextEncoderStream());
}

/**
 * Convert an SSE ReadableStream back to an async iterator.
 * "message" events are yielded. "error" events throw. "done" events return.
 */
export function eventStreamToIterator<T = unknown>(
  stream: ReadableStream<Uint8Array>,
  options: {
    deserialize?: (data: string) => T;
  } = {},
): AsyncIteratorClass<T> {
  const deserialize = options.deserialize ?? ((d: string) => JSON.parse(d) as T);
  const decodedStream = stream.pipeThrough(new TextDecoderStream() as any);
  const reader = decodedStream.getReader();

  const eventQueue: EventMessage[] = [];
  let eventResolve: (() => void) | undefined;
  let streamDone = false;

  const pushEvent = (msg: EventMessage) => {
    eventQueue.push(msg);
    eventResolve?.();
    eventResolve = undefined;
  };

  const sseDecoder = new EventDecoder(pushEvent);

  // Background reader
  const readLoop = async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          sseDecoder.flush();
          streamDone = true;
          eventResolve?.();
          break;
        }
        sseDecoder.feed(value as string);
      }
    } catch {
      streamDone = true;
      eventResolve?.();
    }
  };

  void readLoop();

  return new AsyncIteratorClass<T>(
    async () => {
      while (true) {
        if (eventQueue.length > 0) {
          const msg = eventQueue.shift()!;
          switch (msg.event) {
            case "message": {
              const value = msg.data ? deserialize(msg.data) : (undefined as T);
              const result = msg.id || msg.retry
                ? withEventMeta(value as any, { id: msg.id, retry: msg.retry }) as T
                : value;
              return { done: false, value: result };
            }
            case "error": {
              const errorData = msg.data ? JSON.parse(msg.data) : {};
              throw Object.assign(new Error(errorData.message ?? "Stream error"), errorData);
            }
            case "done": {
              return { done: true, value: undefined } as IteratorReturnResult<void>;
            }
            default:
              continue;
          }
        }

        if (streamDone) {
          return { done: true, value: undefined } as IteratorReturnResult<void>;
        }

        await new Promise<void>((resolve) => {
          eventResolve = resolve;
        });
      }
    },
    async () => {
      try { reader.releaseLock(); } catch {}
      try { await decodedStream.cancel(); } catch {}
    },
  );
}

/**
 * Check if headers indicate an SSE stream.
 */
export function isEventStreamHeaders(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const ct = headers["content-type"];
  if (typeof ct === "string") return ct.includes("text/event-stream");
  if (Array.isArray(ct)) return ct.some((v) => v.includes("text/event-stream"));
  return false;
}
