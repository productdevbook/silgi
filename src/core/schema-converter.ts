/**
 * Schema-to-JSON-Schema conversion
 * ----------------------------------
 *
 * The core framework stays validator-agnostic: it never imports Zod,
 * Valibot, ArkType, or any other schema library. When OpenAPI or
 * analytics needs to see the *shape* of an `input` / `output` schema,
 * this module is what they ask.
 *
 * How a schema is resolved (in order):
 *
 *   1. **Standard JSON Schema extension.** If the schema's
 *      `~standard.jsonSchema.input()` / `.output()` is present (Zod v4.2+,
 *      ArkType v2.1.28+, Valibot v1.2+ via `toStandardJsonSchema`), we
 *      call it directly. No registry needed. This is the recommended
 *      path in the wider ecosystem.
 *   2. **Vendor-keyed registry lookup.** For libraries that haven't
 *      adopted the extension yet (e.g. Zod v3), users pass converters
 *      explicitly via `silgi({ schemaConverters: [zodConverter] })`.
 *      The silgi factory builds a per-instance `SchemaRegistry` and
 *      threads it through to `wrapWithScalar` / `wrapWithAnalytics`.
 *   3. **Empty schema `{}`.** Emits a single `console.warn` per vendor
 *      when a registry was provided but contained no matching converter.
 *      No warn when no registry was passed — the caller opted out.
 *
 * There is no module-scoped or global mutable state (the warn set only
 * holds bounded vendor-name strings, described where it is declared).
 *
 * @see https://standardschema.dev/json-schema — the upstream spec.
 *
 * @category Schema
 */

import type { AnySchema } from './schema.ts'

// ─── JSON Schema shape we expose ──────────────────────────────────────

/**
 * JSON Schema subset used across silgi's OpenAPI and analytics output.
 * Intentionally broad (`[key: string]: unknown`) so library-specific
 * fields (e.g. Zod's `x-native-type`) pass through untouched.
 *
 * @category Schema
 */
export interface JSONSchema {
  type?: string | string[]
  format?: string
  properties?: Record<string, JSONSchema>
  required?: string[]
  items?: JSONSchema
  anyOf?: JSONSchema[]
  oneOf?: JSONSchema[]
  allOf?: JSONSchema[]
  enum?: unknown[]
  const?: unknown
  description?: string
  title?: string
  default?: unknown
  [key: string]: unknown
}

// ─── JSON Schema target dialects ──────────────────────────────────────

/**
 * JSON Schema dialect passed through to the schema library. Matches the
 * `target` field of the Standard JSON Schema spec. Unknown strings are
 * allowed so new dialects can be threaded through without a silgi
 * release; libraries that do not recognise the value should throw and
 * the conversion falls back to an empty schema.
 *
 * @category Schema
 */
export type JSONSchemaTarget = 'draft-2020-12' | 'draft-07' | 'openapi-3.0' | (string & {})

// ─── Public converter interface ───────────────────────────────────────

/**
 * Options passed to a converter's `toJsonSchema` method.
 *
 * @category Schema
 */
export interface ConvertOptions {
  /** `'input'` for pre-transform types, `'output'` for post-transform. */
  strategy: 'input' | 'output'
  /** JSON Schema dialect to target. Defaults to `'draft-2020-12'`. */
  target?: JSONSchemaTarget
  /** Opaque options the converter may forward to its underlying library. */
  libraryOptions?: Record<string, unknown>
}

/**
 * Fallback converter for a schema library that has not adopted the
 * Standard JSON Schema extension yet. Pass instances via
 * `silgi({ schemaConverters: [...] })`.
 *
 * @remarks
 * Libraries that *do* implement the extension (Zod v4.2+, ArkType
 * v2.1.28+, Valibot v1.2+) are handled without a converter — silgi
 * calls their native `~standard.jsonSchema` directly. Write a converter
 * only when you need to support a vendor that has not yet adopted the
 * spec.
 *
 * @example
 *   import type { SchemaConverter } from 'silgi'
 *
 *   const myConverter: SchemaConverter = {
 *     vendor: 'my-lib',
 *     toJsonSchema(schema, opts) {
 *       return { type: 'string' }
 *     },
 *   }
 *
 * @category Schema
 */
export interface SchemaConverter {
  /** Matches the `~standard.vendor` reported by the schema library. */
  vendor: string
  /**
   * Convert a schema to a JSON Schema object. Return `{}` for schemas
   * the converter does not understand.
   */
  toJsonSchema(schema: AnySchema, opts: ConvertOptions): JSONSchema
}

/**
 * Per-instance mapping of vendor string → fallback converter. Built by
 * {@link createSchemaRegistry} and threaded through the handler pipeline
 * to the scalar and analytics wrappers. Using `Map` gives O(1) lookup
 * and keyed-by-vendor semantics that match the spec's own extension
 * contract.
 *
 * @category Schema
 */
export type SchemaRegistry = Map<string, SchemaConverter>

/**
 * Build a {@link SchemaRegistry} from an array of converters.
 *
 * @example
 *   import { zodConverter } from 'silgi/zod'
 *   const registry = createSchemaRegistry([zodConverter])
 *
 * @category Schema
 */
export function createSchemaRegistry(converters: SchemaConverter[] = []): SchemaRegistry {
  const map = new Map<string, SchemaConverter>()
  for (const converter of converters) {
    map.set(converter.vendor, converter)
  }
  return map
}

// ─── Implementation ───────────────────────────────────────────────────

/**
 * Vendor names we've already warned about. Module-scoped so the
 * warning fires at most once per vendor per process lifetime — across
 * every silgi instance in the same process. The set only holds bounded
 * vendor strings (no schema data, no user input), so sharing it
 * globally is safe.
 */
const warnedVendors = new Set<string>()

/**
 * Shape of the `~standard` slot we read off an arbitrary schema. We
 * name it explicitly and narrow manually rather than reaching for
 * `any` — the rest of the module stays typed, and we never assume the
 * library filled in fields we did not ask for.
 */
interface StandardSlot {
  vendor?: unknown
  jsonSchema?: {
    input?: (options: { target: JSONSchemaTarget; libraryOptions?: Record<string, unknown> }) => unknown
    output?: (options: { target: JSONSchemaTarget; libraryOptions?: Record<string, unknown> }) => unknown
  }
}

/** Read the `~standard` slot off an AnySchema in one typed step. */
const readStandardSlot = (schema: AnySchema): StandardSlot | undefined =>
  (schema as { '~standard'?: StandardSlot })['~standard']

/**
 * Call the Standard JSON Schema extension on a schema that exposes it.
 * Returns `null` when the extension does not handle this strategy or
 * throws (in which case the caller falls back to the registry).
 *
 * We strip the `$schema` meta field because it is a JSON Schema marker,
 * not a member of the schema itself — silgi never propagates it.
 */
function callNativeJsonSchema(
  std: StandardSlot,
  opts: Required<Pick<ConvertOptions, 'strategy' | 'target'>> & Pick<ConvertOptions, 'libraryOptions'>,
): JSONSchema | null {
  const generator = opts.strategy === 'output' ? std.jsonSchema?.output : std.jsonSchema?.input
  if (!generator) return null

  try {
    const result = generator({ target: opts.target, libraryOptions: opts.libraryOptions })
    if (!result || typeof result !== 'object') return null
    const { $schema: _ignored, ...rest } = result as Record<string, unknown>
    return rest as JSONSchema
  } catch {
    // Library threw on this target / library-option combination.
    // Fall back to the registry — a converter might still handle it.
    return null
  }
}

/** Warn once per vendor when a registry was passed but had no match. */
function warnMissingConverter(vendor: string): void {
  if (warnedVendors.has(vendor)) return
  warnedVendors.add(vendor)
  console.warn(
    `[silgi] No schema converter registered for vendor "${vendor}". ` +
      `Pass schemaConverters: [${vendor}Converter] to silgi() to enable OpenAPI / analytics schema generation.`,
  )
}

/**
 * Convert any Standard Schema to a JSON Schema object.
 *
 * @param schema   The schema to convert.
 * @param strategy `'input'` (default) for pre-transform types, `'output'`
 *                 for post-transform. Matters for schemas that coerce
 *                 (e.g. `z.coerce.number()` takes a string and yields a
 *                 number — input and output schemas differ).
 * @param registry Optional fallback registry built by
 *                 {@link createSchemaRegistry}. Omit to rely solely on
 *                 the native Standard JSON Schema extension.
 * @param options  Extra knobs: `target` dialect (default
 *                 `'draft-2020-12'`), opaque `libraryOptions`
 *                 forwarded to the underlying library.
 *
 * @returns A JSON Schema object. `{}` when the schema cannot be
 *          converted (silent fallback — analytics / OpenAPI output
 *          still renders, just without schema detail for that field).
 *
 * @example
 *   import { zodConverter } from 'silgi/zod'
 *   import { createSchemaRegistry, schemaToJsonSchema } from 'silgi'
 *
 *   const registry = createSchemaRegistry([zodConverter])
 *   const json = schemaToJsonSchema(MySchema, 'input', registry)
 *
 * @category Schema
 */
export function schemaToJsonSchema(
  schema: AnySchema,
  strategy: 'input' | 'output' = 'input',
  registry?: SchemaRegistry,
  options: { target?: JSONSchemaTarget; libraryOptions?: Record<string, unknown> } = {},
): JSONSchema {
  const std = readStandardSlot(schema)
  if (!std) return {}

  const target = options.target ?? 'draft-2020-12'

  // Step 1 — Standard JSON Schema extension (preferred path).
  const native = callNativeJsonSchema(std, {
    strategy,
    target,
    libraryOptions: options.libraryOptions,
  })
  if (native !== null) return native

  // Step 2 — vendor-keyed fallback registry.
  const vendor = typeof std.vendor === 'string' ? std.vendor : undefined
  if (!vendor || !registry) return {}

  const converter = registry.get(vendor)
  if (!converter) {
    warnMissingConverter(vendor)
    return {}
  }

  try {
    return converter.toJsonSchema(schema, { strategy, target, libraryOptions: options.libraryOptions })
  } catch {
    // Converter threw — fall through to `{}` so an OpenAPI or analytics
    // consumer (which cannot do anything with a low-level error anyway)
    // still renders the rest of the document.
    return {}
  }
}
