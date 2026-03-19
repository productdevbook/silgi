import { describe, it, expect, vi } from "vitest";

describe("OpenAPILink", () => {
  it("makes POST requests by default", async () => {
    const { OpenAPILink } = await import("#src/client/openapi.ts");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const link = new OpenAPILink({
      url: "https://api.example.com",
      fetch: mockFetch,
    });

    const result = await link.call(["health"], undefined, {});
    expect(result).toEqual({ status: "ok" });
    expect(mockFetch).toHaveBeenCalledWith(
      "https://api.example.com/health",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses GET when spec indicates", async () => {
    const { OpenAPILink } = await import("#src/client/openapi.ts");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const link = new OpenAPILink({
      url: "https://api.example.com",
      spec: {
        paths: {
          "/users": { get: {} },
        },
      },
      fetch: mockFetch,
    });

    await link.call(["users"], { limit: 10 }, {});
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("limit=10"),
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("throws KatmanError on non-ok response", async () => {
    const { OpenAPILink } = await import("#src/client/openapi.ts");

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "NOT_FOUND", message: "nope" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    const link = new OpenAPILink({ url: "https://api.example.com", fetch: mockFetch });

    await expect(link.call(["missing"], {}, {})).rejects.toMatchObject({
      status: 404,
    });
  });
});
