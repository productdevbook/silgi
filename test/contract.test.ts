import { describe, it, expect } from "vitest";
import { kc, ContractBuilder } from "../src/contract/builder.ts";
import { isContractProcedure, ContractProcedure } from "../src/contract/procedure.ts";

describe("Contract Builder (kc)", () => {
  it("is a ContractBuilder instance", () => {
    expect(kc).toBeInstanceOf(ContractBuilder);
  });

  it("creates a contract procedure with input/output", async () => {
    const { z } = await import("zod");
    const contract = kc
      .input(z.object({ name: z.string() }))
      .output(z.object({ id: z.number() }));

    expect(isContractProcedure(contract)).toBe(true);
    expect(contract["~katman"].inputSchema).toBeDefined();
    expect(contract["~katman"].outputSchema).toBeDefined();
  });

  it("adds errors", () => {
    const contract = kc.errors({
      NOT_FOUND: { status: 404, message: "Not found" },
      CONFLICT: { status: 409 },
    });

    expect(contract["~katman"].errorMap).toHaveProperty("NOT_FOUND");
    expect(contract["~katman"].errorMap).toHaveProperty("CONFLICT");
  });

  it("sets route metadata", () => {
    const contract = kc.route({ method: "GET", path: "/users" });
    expect(contract["~katman"].route.method).toBe("GET");
    expect(contract["~katman"].route.path).toBe("/users");
  });

  it("adds meta", () => {
    const contract = kc.meta({ auth: true });
    expect(contract["~katman"].meta).toEqual({ auth: true });
  });

  it("immutable — each method returns a new builder", () => {
    const a = kc.route({ method: "GET" });
    const b = a.route({ path: "/test" });
    expect(a["~katman"].route.path).toBeUndefined();
    expect(b["~katman"].route.path).toBe("/test");
    expect(b["~katman"].route.method).toBe("GET");
  });

  it("creates a contract router with prefix and tags", async () => {
    const { z } = await import("zod");
    const listUsers = kc
      .route({ method: "GET", path: "/users" })
      .input(z.object({ limit: z.number().optional() }));

    const router = kc.prefix("/api/v1").tag("users").router({
      users: { list: listUsers },
    });

    const enhanced = (router as any).users.list as ContractProcedure;
    expect(isContractProcedure(enhanced)).toBe(true);
    expect(enhanced["~katman"].route.path).toBe("/api/v1/users");
    expect(enhanced["~katman"].route.tags).toContain("users");
  });

  it("validates successStatus is not an error", () => {
    expect(
      () => new ContractProcedure({ errorMap: {}, route: { successStatus: 404 }, meta: {} }),
    ).toThrow("error status");
  });

  it("validates error map statuses are errors", () => {
    expect(
      () => new ContractProcedure({
        errorMap: { BAD: { status: 200 } },
        route: {},
        meta: {},
      }),
    ).toThrow("non-error status");
  });
});
