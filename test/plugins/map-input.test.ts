import { describe, it, expect } from "vitest";
import { mapInput } from "#src/map-input.ts";

describe("mapInput()", () => {
  it("creates a wrap middleware", () => {
    const mapper = mapInput((input: any) => ({ id: input.userId }));
    expect(mapper.kind).toBe("wrap");
    expect(typeof mapper.fn).toBe("function");
  });
});
