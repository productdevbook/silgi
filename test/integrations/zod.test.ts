import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ZodSchemaConverter } from "#src/integrations/zod/converter.ts";

const converter = new ZodSchemaConverter();

describe("Zod → JSON Schema Converter", () => {
  it("converts string", () => {
    const [req, schema] = converter.convert(z.string() as any, { strategy: "input" });
    expect(req).toBe(true);
    expect(schema.type).toBe("string");
  });

  it("converts string with constraints", () => {
    const [, schema] = converter.convert(
      z.string().min(3).max(100).email() as any,
      { strategy: "input" },
    );
    expect(schema.type).toBe("string");
    expect(schema.minLength).toBe(3);
    expect(schema.maxLength).toBe(100);
    expect(schema.format).toBe("email");
  });

  it("converts number", () => {
    const [, schema] = converter.convert(z.number() as any, { strategy: "input" });
    expect(schema.type).toBe("number");
  });

  it("converts number with constraints", () => {
    const [, schema] = converter.convert(
      z.number().min(0).max(100) as any,
      { strategy: "input" },
    );
    expect(schema.minimum).toBe(0);
    expect(schema.maximum).toBe(100);
  });

  it("converts integer", () => {
    const [, schema] = converter.convert(z.number().int() as any, { strategy: "input" });
    expect(schema.type).toBe("integer");
  });

  it("converts boolean", () => {
    const [, schema] = converter.convert(z.boolean() as any, { strategy: "input" });
    expect(schema.type).toBe("boolean");
  });

  it("converts object with required/optional fields", () => {
    const [, schema] = converter.convert(
      z.object({ name: z.string(), age: z.number().optional() }) as any,
      { strategy: "input" },
    );
    expect(schema.type).toBe("object");
    expect(schema.properties!.name.type).toBe("string");
    expect(schema.properties!.age.type).toBe("number");
    expect(schema.required).toContain("name");
    expect(schema.required).not.toContain("age");
  });

  it("converts array", () => {
    const [, schema] = converter.convert(z.array(z.string()) as any, { strategy: "input" });
    expect(schema.type).toBe("array");
    expect(schema.items!.type).toBe("string");
  });

  it("converts array with min/max", () => {
    const [, schema] = converter.convert(
      z.array(z.number()).min(1).max(10) as any,
      { strategy: "input" },
    );
    expect(schema.minItems).toBe(1);
    expect(schema.maxItems).toBe(10);
  });

  it("converts enum", () => {
    const [, schema] = converter.convert(
      z.enum(["active", "inactive", "banned"]) as any,
      { strategy: "input" },
    );
    expect(schema.enum).toEqual(["active", "inactive", "banned"]);
  });

  it("converts union (anyOf)", () => {
    const [, schema] = converter.convert(
      z.union([z.string(), z.number()]) as any,
      { strategy: "input" },
    );
    expect(schema.anyOf).toBeDefined();
    expect(schema.anyOf).toHaveLength(2);
  });

  it("converts nullable", () => {
    const [, schema] = converter.convert(z.string().nullable() as any, { strategy: "input" });
    expect(schema.anyOf).toBeDefined();
    expect(schema.anyOf!.some((s: any) => s.type === "null")).toBe(true);
    expect(schema.anyOf!.some((s: any) => s.type === "string")).toBe(true);
  });

  it("converts optional (required=false)", () => {
    const [req, schema] = converter.convert(z.string().optional() as any, { strategy: "input" });
    expect(req).toBe(false);
    expect(schema.type).toBe("string");
  });

  it("converts default (required=false, has default)", () => {
    const [req, schema] = converter.convert(
      z.string().default("hello") as any,
      { strategy: "input" },
    );
    expect(req).toBe(false);
    expect(schema.default).toBe("hello");
  });

  it("converts literal", () => {
    const [, schema] = converter.convert(z.literal("active") as any, { strategy: "input" });
    expect(schema.const).toBe("active");
  });

  it("converts tuple", () => {
    const [, schema] = converter.convert(
      z.tuple([z.string(), z.number()]) as any,
      { strategy: "input" },
    );
    expect(schema.type).toBe("array");
    expect(schema.prefixItems).toHaveLength(2);
  });

  it("converts record", () => {
    const [, schema] = converter.convert(
      z.record(z.string(), z.number()) as any,
      { strategy: "input" },
    );
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBeDefined();
  });

  it("converts date to string with format", () => {
    const [, schema] = converter.convert(z.date() as any, { strategy: "input" });
    expect(schema.type).toBe("string");
    expect(schema.format).toBe("date-time");
    expect(schema["x-native-type"]).toBe("date");
  });

  it("converts bigint with x-native-type", () => {
    const [, schema] = converter.convert(z.bigint() as any, { strategy: "input" });
    expect(schema.type).toBe("string");
    expect(schema["x-native-type"]).toBe("bigint");
  });

  it("handles nested objects", () => {
    const AddressSchema = z.object({
      street: z.string(),
      city: z.string(),
      zip: z.string(),
    });
    const UserSchema = z.object({
      name: z.string(),
      address: AddressSchema,
    });

    const [, schema] = converter.convert(UserSchema as any, { strategy: "input" });
    expect(schema.properties!.address.type).toBe("object");
    expect(schema.properties!.address.properties!.street.type).toBe("string");
  });

  it("identifies as zod vendor", () => {
    expect(converter.condition(z.string() as any)).toBe(true);
    expect(converter.condition({ "~standard": { vendor: "valibot" } } as any)).toBe(false);
  });
});
