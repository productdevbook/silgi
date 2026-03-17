import { describe, it, expect } from "vitest";
import {
  encodeEventMessage,
  EventDecoder,
  iteratorToEventStream,
  eventStreamToIterator,
  withEventMeta,
  getEventMeta,
  isEventStreamHeaders,
} from "../src/core/sse.ts";
import { AsyncIteratorClass } from "../src/core/iterator.ts";

describe("SSE: Event Metadata", () => {
  it("attaches and retrieves metadata", () => {
    const data = { name: "Alice" };
    const withMeta = withEventMeta(data, { id: "evt-1", retry: 5000 });

    expect(withMeta.name).toBe("Alice");
    expect(getEventMeta(withMeta)).toEqual({ id: "evt-1", retry: 5000 });
  });

  it("returns undefined for non-objects", () => {
    expect(getEventMeta("string")).toBeUndefined();
    expect(getEventMeta(null)).toBeUndefined();
    expect(getEventMeta(42)).toBeUndefined();
  });

  it("returns undefined for untagged objects", () => {
    expect(getEventMeta({ name: "Alice" })).toBeUndefined();
  });
});

describe("SSE: Encoder", () => {
  it("encodes a message event", () => {
    const encoded = encodeEventMessage({
      event: "message",
      data: '{"name":"Alice"}',
      id: "1",
    });
    expect(encoded).toContain("event: message\n");
    expect(encoded).toContain('data: {"name":"Alice"}\n');
    expect(encoded).toContain("id: 1\n");
    expect(encoded.endsWith("\n\n")).toBe(true);
  });

  it("encodes multiline data", () => {
    const encoded = encodeEventMessage({ data: "line1\nline2\nline3" });
    expect(encoded).toContain("data: line1\n");
    expect(encoded).toContain("data: line2\n");
    expect(encoded).toContain("data: line3\n");
  });

  it("encodes comments", () => {
    const encoded = encodeEventMessage({ comment: "keepalive" });
    expect(encoded).toContain(": keepalive\n");
  });

  it("encodes retry", () => {
    const encoded = encodeEventMessage({ event: "message", data: "x", retry: 3000 });
    expect(encoded).toContain("retry: 3000\n");
  });
});

describe("SSE: Decoder", () => {
  it("parses a single complete message", () => {
    const events: any[] = [];
    const decoder = new EventDecoder((msg) => events.push(msg));

    decoder.feed("event: message\ndata: hello\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
    expect(events[0].data).toBe("hello");
  });

  it("handles chunked data", () => {
    const events: any[] = [];
    const decoder = new EventDecoder((msg) => events.push(msg));

    decoder.feed("event: mess");
    expect(events).toHaveLength(0);
    decoder.feed("age\ndata: hello\n\n");
    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("message");
  });

  it("parses multiple messages", () => {
    const events: any[] = [];
    const decoder = new EventDecoder((msg) => events.push(msg));

    decoder.feed("event: a\ndata: 1\n\nevent: b\ndata: 2\n\n");
    expect(events).toHaveLength(2);
  });

  it("parses id and retry", () => {
    const events: any[] = [];
    const decoder = new EventDecoder((msg) => events.push(msg));

    decoder.feed("id: 42\nretry: 5000\ndata: test\n\n");
    expect(events[0].id).toBe("42");
    expect(events[0].retry).toBe(5000);
    expect(events[0].data).toBe("test");
  });

  it("handles flush for incomplete data", () => {
    const events: any[] = [];
    const decoder = new EventDecoder((msg) => events.push(msg));

    decoder.feed("data: incomplete");
    expect(events).toHaveLength(0);
    decoder.flush();
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe("incomplete");
  });
});

describe("SSE: Iterator ↔ Stream", () => {
  it("converts iterator to event stream and back", async () => {
    // Create a source iterator
    let i = 0;
    const source = new AsyncIteratorClass<number>(async () => {
      if (i >= 3) return { done: true, value: undefined as unknown as number };
      return { done: false, value: i++ };
    });

    // Convert to SSE stream
    const stream = iteratorToEventStream(source, { initialComment: "hi" });

    // Convert back to iterator
    const iterator = eventStreamToIterator<number>(stream);

    const values: number[] = [];
    for await (const value of iterator) {
      values.push(value);
    }

    expect(values).toEqual([0, 1, 2]);
  });

  it("preserves event metadata through round-trip", async () => {
    let yielded = false;
    const source = new AsyncIteratorClass<{ count: number }>(async () => {
      if (yielded) return { done: true, value: undefined as unknown as { count: number } };
      yielded = true;
      const value = withEventMeta({ count: 1 }, { id: "evt-1" });
      return { done: false, value };
    });

    const stream = iteratorToEventStream(source as any);
    const decodedStream = stream.pipeThrough(new TextDecoderStream());
    const reader = decodedStream.getReader();

    // Read the first data message (skip initial comment if any)
    let text = "";
    for (let i = 0; i < 5; i++) {
      const { done, value } = await reader.read();
      if (done) break;
      text += value;
      if (text.includes("event: message")) break;
    }

    expect(text).toContain("event: message");
    expect(text).toContain("id: evt-1");
    expect(text).toContain('"count":1');

    reader.releaseLock();
    await decodedStream.cancel();
  });
});

describe("SSE: Header detection", () => {
  it("detects event-stream content type", () => {
    expect(isEventStreamHeaders({ "content-type": "text/event-stream" })).toBe(true);
    expect(isEventStreamHeaders({ "content-type": "application/json" })).toBe(false);
    expect(isEventStreamHeaders({})).toBe(false);
  });
});
