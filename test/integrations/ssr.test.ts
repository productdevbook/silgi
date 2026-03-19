import { describe, it, expect } from "vitest";

describe("SSR utilities", () => {
  it("createSSRSerializer handles Date", async () => {
    const { createSSRSerializer } = await import("#src/integrations/tanstack-query/ssr.ts");
    const serializer = createSSRSerializer();

    const data = { created: new Date("2026-01-01"), count: 42 };
    const json = serializer.serialize(data);
    const parsed = serializer.deserialize(json) as typeof data;

    expect(parsed.created).toBeInstanceOf(Date);
    expect(parsed.created.getFullYear()).toBe(2026);
    expect(parsed.count).toBe(42);
  });

  it("createSSRSerializer handles Map and Set", async () => {
    const { createSSRSerializer } = await import("#src/integrations/tanstack-query/ssr.ts");
    const serializer = createSSRSerializer();

    const data = {
      tags: new Set(["a", "b"]),
      meta: new Map([["key", "value"]]),
    };
    const json = serializer.serialize(data);
    const parsed = serializer.deserialize(json) as typeof data;

    expect(parsed.tags).toBeInstanceOf(Set);
    expect(parsed.tags.has("a")).toBe(true);
    expect(parsed.meta).toBeInstanceOf(Map);
    expect(parsed.meta.get("key")).toBe("value");
  });
});
