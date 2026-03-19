import { describe, it, expect } from "vitest";
import { bodyLimitGuard } from "#src/plugins/body-limit.ts";

describe("bodyLimitGuard()", () => {
  it("passes when under limit", () => {
    const guard = bodyLimitGuard({ maxBytes: 1000 });
    expect(() => guard.fn({ headers: { "content-length": "500" } })).not.toThrow();
  });

  it("throws when over limit", () => {
    const guard = bodyLimitGuard({ maxBytes: 100 });
    expect(() => guard.fn({ headers: { "content-length": "200" } })).toThrow();
  });

  it("passes when no content-length", () => {
    const guard = bodyLimitGuard({ maxBytes: 100 });
    expect(() => guard.fn({ headers: {} })).not.toThrow();
  });
});
