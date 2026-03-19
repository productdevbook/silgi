import { describe, it, expect, vi } from "vitest";

describe("withInterceptors", () => {
  it("calls onRequest and onResponse", async () => {
    const { withInterceptors } = await import("#src/client/interceptor.ts");

    const events: string[] = [];
    const baseLink = { call: vi.fn().mockResolvedValue("result") };

    const link = withInterceptors(baseLink, {
      onRequest: () => { events.push("request"); },
      onResponse: () => { events.push("response"); },
    });

    await link.call(["test"], {}, {});
    expect(events).toEqual(["request", "response"]);
  });

  it("calls onError on failure", async () => {
    const { withInterceptors } = await import("#src/client/interceptor.ts");

    const events: string[] = [];
    const baseLink = { call: vi.fn().mockRejectedValue(new Error("fail")) };

    const link = withInterceptors(baseLink, {
      onError: () => { events.push("error"); },
    });

    await expect(link.call(["test"], {}, {})).rejects.toThrow("fail");
    expect(events).toEqual(["error"]);
  });

  it("measures duration in onResponse", async () => {
    const { withInterceptors } = await import("#src/client/interceptor.ts");

    let measuredDuration = 0;
    const baseLink = {
      call: vi.fn().mockImplementation(() => new Promise(r => setTimeout(() => r("ok"), 50))),
    };

    const link = withInterceptors(baseLink, {
      onResponse: ({ durationMs }) => { measuredDuration = durationMs; },
    });

    await link.call(["test"], {}, {} as any);
    expect(measuredDuration).toBeGreaterThan(10);
  });

  it("propagates errors after onError", async () => {
    const { withInterceptors } = await import("#src/client/interceptor.ts");

    const capturedErrors: unknown[] = [];
    const baseLink = { call: vi.fn().mockRejectedValue(new Error("fail")) };

    const link = withInterceptors(baseLink, {
      onError: ({ error }) => { capturedErrors.push(error); },
    });

    await expect(link.call(["x"], {}, {} as any)).rejects.toThrow("fail");
    expect(capturedErrors).toHaveLength(1);
    expect((capturedErrors[0] as Error).message).toBe("fail");
  });
});
