import { describe, it, expect } from "vitest";
import { decodeRequest, encodeResponse, encodeErrorResponse } from "../src/server/adapters/standard/codec.ts";
import { Procedure } from "../src/server/procedure.ts";
import { KatmanError } from "../src/core/error.ts";

describe("RPC Codec", () => {
  const mockProcedure = new Procedure({
    middlewares: [],
    handler: async () => {},
    inputSchema: undefined,
    outputSchema: undefined,
    errorMap: {},
    route: {},
    meta: {},
    inputValidationIndex: 0,
    outputValidationIndex: 0,
  });

  describe("decodeRequest", () => {
    it("decodes GET query parameter", async () => {
      const url = new URL("http://localhost/test?data=" + encodeURIComponent(
        JSON.stringify({ json: { name: "Alice" }, meta: [] }),
      ));
      const request = {
        url,
        method: "GET",
        headers: {},
        body: async () => undefined,
        signal: AbortSignal.timeout(5000),
      };
      const input = await decodeRequest(request);
      expect(input).toEqual({ name: "Alice" });
    });

    it("decodes POST body with json+meta envelope", async () => {
      const request = {
        url: new URL("http://localhost/test"),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: async () => ({
          json: { name: "Alice", joined: "2024-01-01T00:00:00.000Z" },
          meta: [[1, "joined"]], // TypeCode.Date
        }),
        signal: AbortSignal.timeout(5000),
      };
      const input = await decodeRequest(request) as any;
      expect(input.name).toBe("Alice");
      expect(input.joined).toBeInstanceOf(Date);
    });

    it("decodes plain POST body", async () => {
      const request = {
        url: new URL("http://localhost/test"),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: async () => ({ name: "Alice" }),
        signal: AbortSignal.timeout(5000),
      };
      const input = await decodeRequest(request);
      expect(input).toEqual({ name: "Alice" });
    });

    it("returns undefined for empty GET", async () => {
      const request = {
        url: new URL("http://localhost/test"),
        method: "GET",
        headers: {},
        body: async () => undefined,
        signal: AbortSignal.timeout(5000),
      };
      const input = await decodeRequest(request);
      expect(input).toBeUndefined();
    });
  });

  describe("encodeResponse", () => {
    it("encodes primitive output", () => {
      const response = encodeResponse("hello", mockProcedure);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/json");
      const body = response.body as { json: unknown; meta: unknown[] };
      expect(body.json).toBe("hello");
      expect(body.meta).toEqual([]);
    });

    it("encodes Date output with meta", () => {
      const date = new Date("2024-01-01");
      const response = encodeResponse(date, mockProcedure);
      const body = response.body as { json: unknown; meta: unknown[] };
      expect(body.json).toBe(date.toISOString());
      expect(body.meta[0]![0]).toBe(1); // TypeCode.Date
    });

    it("uses custom successStatus from route", () => {
      const proc = new Procedure({
        ...mockProcedure["~katman"],
        route: { successStatus: 201 },
      });
      const response = encodeResponse({}, proc);
      expect(response.status).toBe(201);
    });
  });

  describe("encodeErrorResponse", () => {
    it("encodes a KatmanError", () => {
      const error = new KatmanError("NOT_FOUND", { message: "User not found" });
      const response = encodeErrorResponse(error);
      expect(response.status).toBe(404);
      const body = response.body as any;
      expect(body.code).toBe("NOT_FOUND");
      expect(body.message).toBe("User not found");
    });
  });
});
