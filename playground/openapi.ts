/**
 * Katman Playground — OpenAPI Spec Generation
 *
 * Run: node --experimental-strip-types playground/openapi.ts
 */

import { ks, kc, KatmanError } from "../src/index.ts";
import { OpenAPIGenerator } from "../src/openapi/index.ts";
import { ZodSchemaConverter } from "../src/integrations/zod/index.ts";
import { z } from "zod";

// ── Define contract ─────────────────────────────────

const UserSchema = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().email(),
  role: z.enum(["admin", "user", "guest"]),
  createdAt: z.date(),
});

const router = {
  users: {
    list: ks
      .route({ method: "GET", path: "/users", summary: "List users", tags: ["Users"] })
      .input(z.object({
        limit: z.number().min(1).max(100).optional(),
        offset: z.number().min(0).optional(),
        role: z.enum(["admin", "user", "guest"]).optional(),
      }))
      .output(z.object({
        users: z.array(UserSchema),
        total: z.number(),
      }))
      .handler(async () => ({ users: [], total: 0 })),

    get: ks
      .route({ method: "GET", path: "/users/{id}", summary: "Get user by ID", tags: ["Users"] })
      .input(z.object({ id: z.number() }))
      .output(UserSchema)
      .errors({
        NOT_FOUND: { status: 404, message: "User not found" },
      })
      .handler(async () => { throw new KatmanError("NOT_FOUND"); }),

    create: ks
      .route({ method: "POST", path: "/users", summary: "Create a new user", tags: ["Users"] })
      .input(z.object({
        name: z.string().min(1).max(100),
        email: z.string().email(),
        role: z.enum(["admin", "user", "guest"]).optional(),
      }))
      .output(UserSchema)
      .errors({
        CONFLICT: { status: 409, message: "Email already exists" },
      })
      .handler(async () => { throw new KatmanError("NOT_IMPLEMENTED"); }),

    update: ks
      .route({ method: "PUT", path: "/users/{id}", summary: "Update user", tags: ["Users"], deprecated: true })
      .input(z.object({
        id: z.number(),
        name: z.string().optional(),
        email: z.string().email().optional(),
      }))
      .output(UserSchema)
      .errors({
        NOT_FOUND: { status: 404 },
        CONFLICT: { status: 409, message: "Email already exists" },
      })
      .handler(async () => { throw new KatmanError("NOT_IMPLEMENTED"); }),

    delete: ks
      .route({ method: "DELETE", path: "/users/{id}", summary: "Delete user", tags: ["Users"] })
      .input(z.object({ id: z.number() }))
      .output(z.object({ deleted: z.boolean() }))
      .errors({
        NOT_FOUND: { status: 404 },
        FORBIDDEN: { status: 403, message: "Cannot delete yourself" },
      })
      .handler(async () => { throw new KatmanError("NOT_IMPLEMENTED"); }),
  },

  health: ks
    .route({ method: "GET", path: "/health", summary: "Health check", tags: ["System"] })
    .output(z.object({
      status: z.enum(["ok", "degraded", "down"]),
      uptime: z.number(),
      version: z.string(),
    }))
    .handler(async () => ({
      status: "ok" as const,
      uptime: process.uptime(),
      version: "0.1.0",
    })),
};

// ── Generate spec ───────────────────────────────────

const generator = new OpenAPIGenerator({
  schemaConverters: [new ZodSchemaConverter()],
});

async function main() {
  const spec = await generator.generate(router as any, {
    info: {
      title: "Katman Playground API",
      version: "0.1.0",
      description: "A demo API built with Katman — the fastest type-safe RPC framework",
    },
    servers: [
      { url: "http://localhost:3456", description: "Local development" },
    ],
    tags: [
      { name: "Users", description: "User management endpoints" },
      { name: "System", description: "System health and monitoring" },
    ],
  });

  console.log(JSON.stringify(spec, null, 2));
}

main().catch(console.error);
