/**
 * OpenAPI 3.1.1 spec generator.
 *
 * Traverses a router (or contract router), converts schemas to JSON Schema,
 * and produces a fully compliant OpenAPI document.
 */

import type { AnyRouter } from "../server/router.ts";
import type { AnyProcedure } from "../server/procedure.ts";
import type { AnyContractRouter } from "../contract/router.ts";
import type { AnyContractProcedure } from "../contract/procedure.ts";
import type { JSONSchema, SchemaConverter, ConvertOptions } from "../integrations/zod/converter.ts";
import { CompositeSchemaConverter } from "../integrations/zod/converter.ts";
import { isProcedure } from "../server/procedure.ts";
import { isContractProcedure } from "../contract/procedure.ts";
import { isLazy, unlazy } from "../server/lazy.ts";

export interface OpenAPIDocument {
  openapi: string;
  info: OpenAPIInfo;
  paths: Record<string, Record<string, OpenAPIOperation>>;
  components?: {
    schemas?: Record<string, JSONSchema>;
  };
  tags?: OpenAPITag[];
  servers?: OpenAPIServer[];
}

export interface OpenAPIInfo {
  title: string;
  version: string;
  description?: string;
}

export interface OpenAPITag {
  name: string;
  description?: string;
}

export interface OpenAPIServer {
  url: string;
  description?: string;
}

export interface OpenAPIOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  deprecated?: boolean;
  parameters?: OpenAPIParameter[];
  requestBody?: {
    required?: boolean;
    content: Record<string, { schema: JSONSchema }>;
  };
  responses: Record<string, {
    description: string;
    content?: Record<string, { schema: JSONSchema }>;
  }>;
}

export interface OpenAPIParameter {
  name: string;
  in: "query" | "path" | "header";
  required?: boolean;
  schema: JSONSchema;
  description?: string;
}

export interface GenerateOptions {
  info: OpenAPIInfo;
  servers?: OpenAPIServer[];
  tags?: OpenAPITag[];
  /** Filter which procedures to include */
  filter?: (path: string[], procedure: AnyProcedure | AnyContractProcedure) => boolean;
}

export class OpenAPIGenerator {
  #converter: CompositeSchemaConverter;

  constructor(options: { schemaConverters: SchemaConverter[] }) {
    this.#converter = new CompositeSchemaConverter(options.schemaConverters);
  }

  async generate(
    router: AnyRouter | AnyContractRouter,
    options: GenerateOptions,
  ): Promise<OpenAPIDocument> {
    const doc: OpenAPIDocument = {
      openapi: "3.1.1",
      info: options.info,
      paths: {},
    };

    if (options.servers) doc.servers = options.servers;
    if (options.tags) doc.tags = options.tags;

    // Collect all procedures
    const procedures = await this.#collectProcedures(router);

    for (const [path, proc] of procedures) {
      const def = proc["~katman"];
      if (options.filter && !options.filter(path, proc)) continue;

      const route = def.route ?? {};
      const method = (route.method ?? "POST").toLowerCase();
      const httpPath = route.path ?? "/" + path.join("/");

      const operation = this.#buildOperation(path, proc);

      doc.paths[httpPath] ??= {};
      doc.paths[httpPath]![method] = operation;
    }

    return doc;
  }

  #buildOperation(
    path: string[],
    proc: AnyProcedure | AnyContractProcedure,
  ): OpenAPIOperation {
    const def = proc["~katman"];
    const route = def.route ?? {};
    const method = (route.method ?? "POST").toUpperCase();

    const operation: OpenAPIOperation = {
      operationId: path.join("_"),
      responses: {},
    };

    if (route.summary) operation.summary = route.summary;
    if (route.description) operation.description = route.description;
    if (route.tags?.length) operation.tags = route.tags;
    if (route.deprecated) operation.deprecated = true;

    // Input schema → request body or query params
    if (def.inputSchema) {
      const [, inputJsonSchema] = this.#converter.convert(def.inputSchema, { strategy: "input" });

      if (method === "GET") {
        // GET: convert object properties to query parameters
        operation.parameters = this.#schemaToParameters(inputJsonSchema);
      } else {
        // POST/PUT/PATCH: request body
        operation.requestBody = {
          required: true,
          content: {
            "application/json": { schema: inputJsonSchema },
          },
        };
      }
    }

    // Output schema → success response
    const successStatus = String(route.successStatus ?? 200);
    const successDesc = route.successDescription ?? "Successful response";

    if (def.outputSchema) {
      const [, outputJsonSchema] = this.#converter.convert(def.outputSchema, { strategy: "output" });
      operation.responses[successStatus] = {
        description: successDesc,
        content: {
          "application/json": { schema: outputJsonSchema },
        },
      };
    } else {
      operation.responses[successStatus] = { description: successDesc };
    }

    // Error map → error responses
    if (def.errorMap) {
      const errorsByStatus = new Map<number, { code: string; schema?: JSONSchema }[]>();

      for (const [code, config] of Object.entries(def.errorMap) as [string, { status?: number; data?: any }][]) {
        if (!config) continue;
        const status = config.status ?? 500;
        if (!errorsByStatus.has(status)) errorsByStatus.set(status, []);

        let dataSchema: JSONSchema | undefined;
        if (config.data) {
          [, dataSchema] = this.#converter.convert(config.data, { strategy: "output" });
        }

        errorsByStatus.get(status)!.push({ code, schema: dataSchema });
      }

      for (const [status, errors] of errorsByStatus) {
        const errorSchemas = errors.map((e) => {
          const schema: JSONSchema = {
            type: "object",
            properties: {
              defined: { const: true },
              code: { const: e.code },
              status: { const: status },
              message: { type: "string" },
            },
            required: ["defined", "code", "status", "message"],
          };
          if (e.schema) {
            schema.properties!.data = e.schema;
            schema.required!.push("data");
          }
          return schema;
        });

        operation.responses[String(status)] = {
          description: errors.map((e) => e.code).join(", "),
          content: {
            "application/json": {
              schema: errorSchemas.length === 1 ? errorSchemas[0]! : { anyOf: errorSchemas },
            },
          },
        };
      }
    }

    return operation;
  }

  #schemaToParameters(schema: JSONSchema): OpenAPIParameter[] {
    if (schema.type !== "object" || !schema.properties) return [];

    const params: OpenAPIParameter[] = [];
    const required = new Set(schema.required ?? []);

    for (const [name, propSchema] of Object.entries(schema.properties)) {
      params.push({
        name,
        in: "query",
        required: required.has(name),
        schema: propSchema,
      });
    }

    return params;
  }

  async #collectProcedures(
    router: unknown,
    path: string[] = [],
  ): Promise<Map<string[], AnyProcedure | AnyContractProcedure>> {
    const result = new Map<string[], AnyProcedure | AnyContractProcedure>();

    if (isLazy(router)) {
      router = (await unlazy(router)).default;
    }

    if (isProcedure(router) || isContractProcedure(router)) {
      result.set(path, router as AnyProcedure);
      return result;
    }

    if (typeof router === "object" && router !== null) {
      for (const [key, child] of Object.entries(router as Record<string, unknown>)) {
        const childResults = await this.#collectProcedures(child, [...path, key]);
        for (const [p, proc] of childResults) {
          result.set(p, proc);
        }
      }
    }

    return result;
  }
}
