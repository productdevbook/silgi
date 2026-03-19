/**
 * Custom JSON serializers — extend serialization for custom types.
 *
 * Register custom type handlers that run during JSON stringify/parse.
 * Works with both serve() responses and client deserialization.
 *
 * @example
 * ```ts
 * import { createSerializer } from "katman/plugins"
 *
 * const serializer = createSerializer()
 *   .register("Date", {
 *     test: (v) => v instanceof Date,
 *     serialize: (v) => v.toISOString(),
 *     deserialize: (v) => new Date(v),
 *   })
 *   .register("BigInt", {
 *     test: (v) => typeof v === "bigint",
 *     serialize: (v) => v.toString(),
 *     deserialize: (v) => BigInt(v),
 *   })
 *
 * // Use as JSON replacer/reviver
 * JSON.stringify(data, serializer.replacer)
 * JSON.parse(text, serializer.reviver)
 * ```
 */

export interface TypeHandler<T = unknown> {
  /** Test if a value is this type */
  test: (value: unknown) => boolean;
  /** Convert to JSON-safe value */
  serialize: (value: T) => unknown;
  /** Convert back from JSON-safe value */
  deserialize: (value: unknown) => T;
}

export interface Serializer {
  /** Register a custom type handler. Returns self for chaining. */
  register<T>(tag: string, handler: TypeHandler<T>): Serializer;
  /** JSON.stringify replacer function */
  replacer: (key: string, value: unknown) => unknown;
  /** JSON.parse reviver function */
  reviver: (key: string, value: unknown) => unknown;
  /** Stringify with custom types */
  stringify: (value: unknown) => string;
  /** Parse with custom types */
  parse: (text: string) => unknown;
}

const TYPE_TAG = "__$type";
const VALUE_TAG = "__$value";

/**
 * Create a custom serializer with support for non-JSON types.
 *
 * Values are wrapped as `{ __$type: "Tag", __$value: serialized }`
 * during stringify and unwrapped during parse.
 */
export function createSerializer(): Serializer {
  const handlers = new Map<string, TypeHandler>();

  const replacer = (_key: string, value: unknown): unknown => {
    for (const [tag, handler] of handlers) {
      if (handler.test(value)) {
        return { [TYPE_TAG]: tag, [VALUE_TAG]: handler.serialize(value as any) };
      }
    }
    return value;
  };

  const reviver = (_key: string, value: unknown): unknown => {
    if (
      typeof value === "object" && value !== null &&
      TYPE_TAG in value && VALUE_TAG in value
    ) {
      const tag = (value as any)[TYPE_TAG] as string;
      const handler = handlers.get(tag);
      if (handler) return handler.deserialize((value as any)[VALUE_TAG]);
    }
    return value;
  };

  const serializer: Serializer = {
    register(tag, handler) {
      handlers.set(tag, handler as TypeHandler);
      return serializer;
    },
    replacer,
    reviver,
    stringify: (value) => JSON.stringify(value, replacer),
    parse: (text) => JSON.parse(text, reviver),
  };

  return serializer;
}
