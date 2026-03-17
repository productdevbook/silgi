/**
 * Scalar API Reference — v2 OpenAPI integration.
 *
 * Generates OpenAPI 3.1.0 spec from v2 RouterDef and serves
 * Scalar UI at /reference + spec at /openapi.json.
 */

import type { ProcedureDef, RouterDef, ErrorDefItem } from "./types.ts";
import type { AnySchema } from "../core/schema.ts";

// ── OpenAPI Spec Generation ─────────────────────────

export interface ScalarOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: { url: string; description?: string }[];
}

interface JSONSchema {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  anyOf?: JSONSchema[];
  enum?: unknown[];
  const?: unknown;
  description?: string;
  default?: unknown;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
  [key: string]: unknown;
}

/**
 * Generate OpenAPI 3.1.0 document from a v2 RouterDef.
 */
export function generateOpenAPI(router: RouterDef, options: ScalarOptions = {}): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};

  collectProcedures(router, [], (path, proc) => {
    const httpPath = "/" + path.join("/");
    const method = proc.type === "query" ? "get" : "post";
    const operationId = path.join("_");

    const operation: Record<string, unknown> = {
      operationId,
      tags: path.length > 1 ? [path[0]] : undefined,
      responses: {},
    };

    // Input → request body or query params
    if (proc.input) {
      const schema = zodToJsonSchema(proc.input);
      if (method === "get") {
        operation.parameters = objectSchemaToParams(schema);
      } else {
        operation.requestBody = {
          required: true,
          content: { "application/json": { schema } },
        };
      }
    }

    // Output → 200 response
    if (proc.output) {
      const schema = zodToJsonSchema(proc.output);
      (operation.responses as any)["200"] = {
        description: "Successful response",
        content: { "application/json": { schema } },
      };
    } else {
      (operation.responses as any)["200"] = { description: "Successful response" };
    }

    // Errors → error responses
    if (proc.errors) {
      for (const [code, def] of Object.entries(proc.errors)) {
        const status = typeof def === "number" ? def : def.status;
        const errorSchema: JSONSchema = {
          type: "object",
          properties: {
            code: { const: code },
            status: { const: status },
            message: { type: "string" },
          },
          required: ["code", "status", "message"],
        };
        if (typeof def === "object" && def.data) {
          errorSchema.properties!.data = zodToJsonSchema(def.data);
          errorSchema.required!.push("data");
        }
        (operation.responses as any)[String(status)] = {
          description: code,
          content: { "application/json": { schema: errorSchema } },
        };
      }
    }

    // Subscription
    if (proc.type === "subscription") {
      (operation.responses as any)["200"] = {
        description: "SSE event stream",
        content: { "text/event-stream": { schema: { type: "string" } } },
      };
    }

    paths[httpPath] ??= {};
    paths[httpPath]![method] = operation;
  });

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "Katman API",
      version: options.version ?? "1.0.0",
      ...(options.description ? { description: options.description } : {}),
    },
    ...(options.servers ? { servers: options.servers } : {}),
    paths,
  };
}

// ── Scalar HTML ─────────────────────────────────────

export function scalarHTML(specUrl: string, options: ScalarOptions = {}): string {
  const title = options.title ?? "Katman API";
  return `<!DOCTYPE html>
<html>
<head>
  <title>${title} — Scalar</title>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body>
  <script id="api-reference" data-url="${specUrl}"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body>
</html>`;
}

// ── Helpers ──────────────────────────────────────────

function isProcedureDef(value: unknown): value is ProcedureDef {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "resolve" in value &&
    typeof (value as ProcedureDef).resolve === "function"
  );
}

function collectProcedures(
  node: unknown,
  path: string[],
  cb: (path: string[], proc: ProcedureDef) => void,
): void {
  if (isProcedureDef(node)) {
    cb(path, node);
    return;
  }
  if (typeof node === "object" && node !== null) {
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      collectProcedures(child, [...path, key], cb);
    }
  }
}

/**
 * Convert a Zod / Standard Schema to JSON Schema.
 * Uses Zod v4's ._zod.def when available, falls back to basic type mapping.
 */
function zodToJsonSchema(schema: AnySchema): JSONSchema {
  // Zod v4: schema._zod.def contains the definition
  const zod = (schema as any)._zod ?? (schema as any)._def;
  if (!zod) return {};

  const def = zod.def ?? zod;
  return convertZodDef(def);
}

function convertZodDef(def: any): JSONSchema {
  if (!def) return {};

  const type = def.type ?? def.typeName;

  switch (type) {
    case "string":
      return applyStringChecks({ type: "string" }, def.checks);
    case "number":
    case "float":
      return applyNumberChecks({ type: "number" }, def.checks);
    case "int":
      return applyNumberChecks({ type: "integer" }, def.checks);
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const schema: JSONSchema = { type: "object", properties: {}, required: [] };
      if (def.shape) {
        for (const [key, fieldSchema] of Object.entries(def.shape)) {
          schema.properties![key] = zodToJsonSchema(fieldSchema as AnySchema);
          // Check if field is optional
          const fz = (fieldSchema as any)?._zod?.def ?? (fieldSchema as any)?._def;
          const isOptional = fz?.type === "optional" || fz?.typeName === "ZodOptional" || fz?.optional;
          if (!isOptional) {
            schema.required!.push(key);
          }
        }
      }
      if (!schema.required!.length) delete schema.required;
      return schema;
    }
    case "array":
      return {
        type: "array",
        ...(def.element ? { items: zodToJsonSchema(def.element) } : {}),
      };
    case "optional":
      return zodToJsonSchema(def.innerType ?? def.inner);
    case "nullable":
      return { ...zodToJsonSchema(def.innerType ?? def.inner), nullable: true };
    case "default":
      return { ...zodToJsonSchema(def.innerType ?? def.inner), default: def.defaultValue?.() ?? def.default };
    case "enum":
      return { enum: def.values ?? def.entries };
    case "literal":
      return { const: def.value };
    case "union":
      return { anyOf: (def.options ?? def.members ?? []).map((o: any) => zodToJsonSchema(o)) };
    case "pipe":
    case "transform":
      return zodToJsonSchema(def.in ?? def.innerType ?? def.input);
    default:
      return {};
  }
}

function applyStringChecks(schema: JSONSchema, checks?: any[]): JSONSchema {
  if (!checks) return schema;
  for (const c of checks) {
    if (c.kind === "min" || c.type === "min_length") schema.minLength = c.value ?? c.minimum;
    if (c.kind === "max" || c.type === "max_length") schema.maxLength = c.value ?? c.maximum;
    if (c.kind === "email" || c.type === "email" || c.format === "email") schema.format = "email";
    if (c.kind === "url" || c.type === "url") schema.format = "uri";
    if (c.kind === "uuid" || c.type === "uuid") schema.format = "uuid";
    if (c.kind === "regex" || c.type === "regex") schema.pattern = String(c.value ?? c.regex);
  }
  return schema;
}

function applyNumberChecks(schema: JSONSchema, checks?: any[]): JSONSchema {
  if (!checks) return schema;
  for (const c of checks) {
    if (c.kind === "min" || c.type === "minimum") schema.minimum = c.value ?? c.minimum;
    if (c.kind === "max" || c.type === "maximum") schema.maximum = c.value ?? c.maximum;
  }
  return schema;
}

function objectSchemaToParams(schema: JSONSchema): Record<string, unknown>[] {
  if (schema.type !== "object" || !schema.properties) return [];
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties).map(([name, propSchema]) => ({
    name,
    in: "query",
    required: required.has(name),
    schema: propSchema,
  }));
}
