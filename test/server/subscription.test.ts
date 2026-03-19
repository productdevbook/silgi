/**
 * v2 subscription (SSE) — end-to-end streaming test.
 */

import { describe, it, expect } from "vitest";
import { katman } from "#src/katman.ts";

const k = katman({ context: () => ({}) });

const router = k.router({
  countdown: k.subscription(async function* () {
    for (let i = 3; i > 0; i--) yield { count: i };
  }),
});

const handle = k.handler(router);

describe("v2 subscription (SSE)", () => {
  it("returns text/event-stream content type", async () => {
    const res = await handle(new Request("http://localhost/countdown", { method: "POST" }));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.body).toBeTruthy();
  });

  it("streams all events", async () => {
    const res = await handle(new Request("http://localhost/countdown", { method: "POST" }));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let all = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      all += decoder.decode(value, { stream: true });
    }

    // Should contain data events for count 3, 2, 1
    const dataLines = all.split("\n").filter((l) => l.startsWith("data:"));
    expect(dataLines.length).toBeGreaterThanOrEqual(3);

    const values = dataLines
      .map((l) => l.replace("data: ", "").trim())
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);

    expect(values).toContainEqual({ count: 3 });
    expect(values).toContainEqual({ count: 2 });
    expect(values).toContainEqual({ count: 1 });
  });
});
