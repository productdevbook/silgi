import { describe, it, expect } from "vitest";
import { z } from "zod";
import { OpenAPIGenerator } from "../src/openapi/generator.ts";
import { ZodSchemaConverter } from "../src/integrations/zod/converter.ts";
import { ks } from "../src/server/builder.ts";
import { kc } from "../src/contract/builder.ts";

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodSchemaConverter()],
});

describe("OpenAPI Generator", () => {
  it("generates a basic spec from a router", async () => {
    const router = {
      users: {
        list: ks
          .route({ method: "GET", path: "/users" })
          .input(z.object({ limit: z.number().optional() }))
          .handler(async ({ input }) => []),
      },
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test API", version: "1.0.0" },
    });

    expect(spec.openapi).toBe("3.1.1");
    expect(spec.info.title).toBe("Test API");
    expect(spec.paths["/users"]).toBeDefined();
    expect(spec.paths["/users"]!.get).toBeDefined();
  });

  it("generates query parameters for GET requests", async () => {
    const router = {
      search: ks
        .route({ method: "GET", path: "/search" })
        .input(z.object({ q: z.string(), page: z.number().optional() }))
        .handler(async () => []),
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
    });

    const operation = spec.paths["/search"]!.get!;
    expect(operation.parameters).toBeDefined();
    expect(operation.parameters!.length).toBe(2);

    const qParam = operation.parameters!.find((p) => p.name === "q");
    expect(qParam).toBeDefined();
    expect(qParam!.required).toBe(true);
    expect(qParam!.schema.type).toBe("string");

    const pageParam = operation.parameters!.find((p) => p.name === "page");
    expect(pageParam).toBeDefined();
    expect(pageParam!.required).toBe(false);
  });

  it("generates request body for POST requests", async () => {
    const router = {
      create: ks
        .route({ method: "POST", path: "/users" })
        .input(z.object({ name: z.string(), email: z.string().email() }))
        .handler(async () => ({ id: 1 })),
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
    });

    const operation = spec.paths["/users"]!.post!;
    expect(operation.requestBody).toBeDefined();
    const schema = operation.requestBody!.content["application/json"]!.schema;
    expect(schema.type).toBe("object");
    expect(schema.properties!.name.type).toBe("string");
    expect(schema.properties!.email.format).toBe("email");
  });

  it("generates error responses from error map", async () => {
    const router = {
      get: ks
        .route({ method: "GET", path: "/users/{id}" })
        .errors({
          NOT_FOUND: { status: 404, message: "Not found" },
          FORBIDDEN: { status: 403 },
        })
        .handler(async () => ({})),
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
    });

    const operation = spec.paths["/users/{id}"]!.get!;
    expect(operation.responses["404"]).toBeDefined();
    expect(operation.responses["403"]).toBeDefined();
  });

  it("includes output schema in success response", async () => {
    const UserSchema = z.object({ id: z.number(), name: z.string() });

    const router = {
      get: ks
        .route({ method: "GET", path: "/user" })
        .output(UserSchema)
        .handler(async () => ({ id: 1, name: "Alice" })),
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
    });

    const successResponse = spec.paths["/user"]!.get!.responses["200"];
    expect(successResponse).toBeDefined();
    expect(successResponse!.content!["application/json"]!.schema.properties!.name.type).toBe("string");
  });

  it("uses RPC path when no route.path is set", async () => {
    const router = {
      users: {
        list: ks.handler(async () => []),
        create: ks.handler(async () => ({})),
      },
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
    });

    expect(spec.paths["/users/list"]).toBeDefined();
    expect(spec.paths["/users/create"]).toBeDefined();
  });

  it("includes tags and summary from route metadata", async () => {
    const router = {
      users: ks
        .route({ method: "GET", path: "/users", summary: "List users", tags: ["Users"] })
        .handler(async () => []),
    };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
    });

    const op = spec.paths["/users"]!.get!;
    expect(op.summary).toBe("List users");
    expect(op.tags).toContain("Users");
  });

  it("works with contract routers", async () => {
    const contract = {
      health: kc
        .route({ method: "GET", path: "/health" })
        .output(z.object({ status: z.string() })),
    };

    const spec = await generator.generate(contract as any, {
      info: { title: "Contract API", version: "1.0" },
    });

    expect(spec.paths["/health"]).toBeDefined();
    expect(spec.paths["/health"]!.get!.responses["200"]).toBeDefined();
  });

  it("supports servers configuration", async () => {
    const router = { ping: ks.handler(async () => "pong") };

    const spec = await generator.generate(router as any, {
      info: { title: "Test", version: "1.0" },
      servers: [
        { url: "https://api.example.com", description: "Production" },
        { url: "http://localhost:3000", description: "Development" },
      ],
    });

    expect(spec.servers).toHaveLength(2);
    expect(spec.servers![0]!.url).toBe("https://api.example.com");
  });
});
