import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createActionableClient, createFormAction } from "../src/integrations/react/index.ts";
import { ks } from "../src/server/builder.ts";
import { KatmanError } from "../src/core/error.ts";

describe("React: createActionableClient", () => {
  it("returns [null, data] on success", async () => {
    const proc = ks.handler(async ({ input }) => ({ greeting: `Hi ${input}` }));
    const action = createActionableClient<string, { greeting: string }>(proc);

    const result = await action("Alice");
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ greeting: "Hi Alice" });
  });

  it("returns [error, undefined] on failure", async () => {
    const proc = ks.handler(async () => {
      throw new KatmanError("FORBIDDEN", { message: "No access" });
    });
    const action = createActionableClient<void, never>(proc);

    const result = await action(undefined as void);
    expect(result[0]).toBeDefined();
    expect((result[0] as any).code).toBe("FORBIDDEN");
    expect(result[1]).toBeUndefined();
  });

  it("validates input before calling handler", async () => {
    const proc = ks
      .input(z.object({ name: z.string() }))
      .handler(async ({ input }) => input.name);
    const action = createActionableClient<{ name: string }, string>(proc);

    // Valid input
    const success = await action({ name: "Alice" });
    expect(success[0]).toBeNull();
    expect(success[1]).toBe("Alice");

    // Invalid input
    const failure = await action({ name: 123 } as any);
    expect(failure[0]).toBeDefined();
    expect(failure[1]).toBeUndefined();
  });
});

describe("React: createFormAction", () => {
  it("parses FormData and calls procedure", async () => {
    const proc = ks.handler(async ({ input }) => {
      return { received: input };
    });
    const action = createFormAction<{ received: unknown }>(proc);

    const formData = new FormData();
    formData.set("name", "Alice");
    formData.set("age", "30");

    const result = await action(formData);
    expect(result[0]).toBeNull();
    expect((result[1] as any).received.name).toBe("Alice");
    expect((result[1] as any).received.age).toBe("30");
  });

  it("supports bracket notation", async () => {
    const proc = ks.handler(async ({ input }) => input);
    const action = createFormAction(proc);

    const formData = new FormData();
    formData.set("user[name]", "Alice");
    formData.set("user[email]", "alice@example.com");

    const result = await action(formData);
    expect(result[0]).toBeNull();
    expect((result[1] as any).user.name).toBe("Alice");
    expect((result[1] as any).user.email).toBe("alice@example.com");
  });

  it("supports array bracket notation", async () => {
    const proc = ks.handler(async ({ input }) => input);
    const action = createFormAction(proc);

    const formData = new FormData();
    formData.set("tags[0]", "typescript");
    formData.set("tags[1]", "rpc");

    const result = await action(formData);
    expect(result[0]).toBeNull();
    expect((result[1] as any).tags[0]).toBe("typescript");
    expect((result[1] as any).tags[1]).toBe("rpc");
  });
});
