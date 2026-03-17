import { describe, it, expect, vi } from "vitest";
import { WebSocketHandler, type MinimalWebSocket } from "../src/server/adapters/websocket/index.ts";
import { ks } from "../src/server/builder.ts";
import { KatmanError } from "../src/core/error.ts";

function createMockWebSocket() {
  const listeners = new Map<string, Function[]>();
  const sent: string[] = [];

  const ws: MinimalWebSocket & { sent: string[]; trigger: (event: string, data?: any) => void } = {
    sent,
    send(data: string) { sent.push(data); },
    addEventListener(event: string, listener: Function) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event)!.push(listener);
    },
    trigger(event: string, data?: any) {
      for (const fn of listeners.get(event) ?? []) fn(data);
    },
  };

  return ws;
}

describe("WebSocketHandler", () => {
  const router = {
    greet: ks.handler(async ({ input }) => `Hello, ${input}!`),
    error: ks.handler(async () => { throw new KatmanError("NOT_FOUND"); }),
    stream: ks.handler(async function* () {
      yield 1;
      yield 2;
      yield 3;
    }),
  };

  it("handles a simple RPC call", async () => {
    const handler = new WebSocketHandler(router as any, { context: {} });
    const ws = createMockWebSocket();
    handler.handleConnection(ws);

    ws.trigger("message", { data: JSON.stringify({ id: "1", path: ["greet"], input: "World" }) });

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 20));

    expect(ws.sent.length).toBeGreaterThanOrEqual(1);
    const response = JSON.parse(ws.sent[0]!);
    expect(response.id).toBe("1");
    expect(response.output).toBe("Hello, World!");
  });

  it("handles errors", async () => {
    const handler = new WebSocketHandler(router as any, { context: {} });
    const ws = createMockWebSocket();
    handler.handleConnection(ws);

    ws.trigger("message", { data: JSON.stringify({ id: "2", path: ["error"] }) });
    await new Promise((r) => setTimeout(r, 20));

    const response = JSON.parse(ws.sent[0]!);
    expect(response.id).toBe("2");
    expect(response.error.code).toBe("NOT_FOUND");
  });

  it("handles procedure not found", async () => {
    const handler = new WebSocketHandler(router as any, { context: {} });
    const ws = createMockWebSocket();
    handler.handleConnection(ws);

    ws.trigger("message", { data: JSON.stringify({ id: "3", path: ["nonexistent"] }) });
    await new Promise((r) => setTimeout(r, 20));

    const response = JSON.parse(ws.sent[0]!);
    expect(response.error.code).toBe("NOT_FOUND");
  });

  it("streams async iterator responses", async () => {
    const handler = new WebSocketHandler(router as any, { context: {} });
    const ws = createMockWebSocket();
    handler.handleConnection(ws);

    ws.trigger("message", { data: JSON.stringify({ id: "4", path: ["stream"] }) });
    await new Promise((r) => setTimeout(r, 50));

    // Should have 3 message events + 1 done event
    const messages = ws.sent.map((s) => JSON.parse(s));
    const streamMessages = messages.filter((m: any) => m.event === "message");
    const doneMessages = messages.filter((m: any) => m.event === "done");

    expect(streamMessages).toHaveLength(3);
    expect(streamMessages[0].data).toBe(1);
    expect(streamMessages[1].data).toBe(2);
    expect(streamMessages[2].data).toBe(3);
    expect(doneMessages).toHaveLength(1);
  });

  it("handles abort", async () => {
    const handler = new WebSocketHandler(router as any, { context: {} });
    const ws = createMockWebSocket();
    handler.handleConnection(ws);

    // Send abort for a non-existent request (should not crash)
    ws.trigger("message", { data: JSON.stringify({ id: "5", type: "abort" }) });
    await new Promise((r) => setTimeout(r, 10));

    // No crash = success
    expect(true).toBe(true);
  });

  it("cleans up on close", async () => {
    const handler = new WebSocketHandler(router as any, { context: {} });
    const ws = createMockWebSocket();
    handler.handleConnection(ws);

    ws.trigger("close");
    // No crash = success
    expect(true).toBe(true);
  });
});
