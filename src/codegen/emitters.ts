/**
 * Schema emitters — code generation strategies for each Standard Schema library.
 *
 * Each emitter knows how to produce code strings for a specific validation library.
 * The generic converter delegates to the active emitter.
 */

export type SchemaTarget = 'zod' | 'valibot' | 'arktype'

export interface SchemaEmitter {
  /** Import statement for the generated file */
  importStatement: string
  /** Type inference helper: wraps a schema reference to extract its inferred type */
  inferType(schemaExpr: string): string

  // ── Primitives ──
  string(): string
  number(): string
  int(): string
  boolean(): string
  null(): string
  unknown(): string

  // ── String formats ──
  email(): string
  url(): string
  uuid(): string
  datetime(): string
  date(): string
  ipv4(): string
  ipv6(): string

  // ── Constraints ──
  min(base: string, n: number): string
  max(base: string, n: number): string
  gt(base: string, n: number): string
  lt(base: string, n: number): string
  regex(base: string, pattern: string): string

  // ── Composites ──
  literal(value: unknown): string
  enum(values: unknown[]): string
  array(items: string): string
  object(entries: { key: string; value: string; required: boolean }[]): string
  record(keySchema: string, valueSchema: string): string
  union(members: string[]): string
  discriminatedUnion(discriminator: string, members: string[]): string
  intersection(parts: string[]): string

  // ── Modifiers ──
  optional(base: string): string
  nullable(base: string): string
  default(base: string, value: unknown): string
  describe(base: string, description: string): string
}

// ── Zod Emitter ────────────────────────────────────────

export const zodEmitter: SchemaEmitter = {
  importStatement: "import { z } from 'zod'",
  inferType: (expr) => `z.infer<typeof ${expr}>`,

  string: () => 'z.string()',
  number: () => 'z.number()',
  int: () => 'z.int()',
  boolean: () => 'z.boolean()',
  null: () => 'z.null()',
  unknown: () => 'z.unknown()',

  email: () => 'z.string().email()',
  url: () => 'z.string().url()',
  uuid: () => 'z.string().uuid()',
  datetime: () => 'z.string().datetime()',
  date: () => 'z.string().date()',
  ipv4: () => 'z.string().ip({ version: "v4" })',
  ipv6: () => 'z.string().ip({ version: "v6" })',

  min: (base, n) => `${base}.min(${n})`,
  max: (base, n) => `${base}.max(${n})`,
  gt: (base, n) => `${base}.gt(${n})`,
  lt: (base, n) => `${base}.lt(${n})`,
  regex: (base, pattern) => `${base}.regex(/${pattern}/)`,

  literal: (value) => `z.literal(${JSON.stringify(value)})`,
  enum: (values) => `z.enum([${values.map((v) => JSON.stringify(v)).join(', ')}])`,
  array: (items) => `z.array(${items})`,
  object: (entries) => {
    const lines = entries.map(({ key, value, required }) => {
      const safeName = isSafeIdentifier(key) ? key : JSON.stringify(key)
      return `  ${safeName}: ${value}${required ? '' : '.optional()'}`
    })
    return `z.object({\n${lines.join(',\n')},\n})`
  },
  record: (k, v) => `z.record(${k}, ${v})`,
  union: (members) => `z.union([${members.join(', ')}])`,
  discriminatedUnion: (disc, members) => `z.discriminatedUnion(${JSON.stringify(disc)}, [${members.join(', ')}])`,
  intersection: (parts) => parts.reduce((acc, part) => `${acc}.and(${part})`),

  optional: (base) => `${base}.optional()`,
  nullable: (base) => `${base}.nullable()`,
  default: (base, value) => `${base}.default(${JSON.stringify(value)})`,
  describe: (base, desc) => `${base}.describe(${JSON.stringify(desc)})`,
}

// ── Valibot Emitter ────────────────────────────────────

export const valibotEmitter: SchemaEmitter = {
  importStatement: "import * as v from 'valibot'",
  inferType: (expr) => `v.InferOutput<typeof ${expr}>`,

  string: () => 'v.string()',
  number: () => 'v.number()',
  int: () => 'v.pipe(v.number(), v.integer())',
  boolean: () => 'v.boolean()',
  null: () => 'v.null()',
  unknown: () => 'v.unknown()',

  email: () => 'v.pipe(v.string(), v.email())',
  url: () => 'v.pipe(v.string(), v.url())',
  uuid: () => 'v.pipe(v.string(), v.uuid())',
  datetime: () => 'v.pipe(v.string(), v.isoTimestamp())',
  date: () => 'v.pipe(v.string(), v.isoDate())',
  ipv4: () => 'v.pipe(v.string(), v.ipv4())',
  ipv6: () => 'v.pipe(v.string(), v.ipv6())',

  min: (base, n) => wrapValibotPipe(base, `v.minValue(${n})`),
  max: (base, n) => wrapValibotPipe(base, `v.maxValue(${n})`),
  gt: (base, n) => wrapValibotPipe(base, `v.gtValue(${n})`),
  lt: (base, n) => wrapValibotPipe(base, `v.ltValue(${n})`),
  regex: (base, pattern) => wrapValibotPipe(base, `v.regex(/${pattern}/)`),

  literal: (value) => `v.literal(${JSON.stringify(value)})`,
  enum: (values) => `v.picklist([${values.map((v) => JSON.stringify(v)).join(', ')}])`,
  array: (items) => `v.array(${items})`,
  object: (entries) => {
    const requiredEntries = entries.filter((e) => e.required)
    const optionalEntries = entries.filter((e) => !e.required)

    const lines = [
      ...requiredEntries.map(({ key, value }) => {
        const safeName = isSafeIdentifier(key) ? key : JSON.stringify(key)
        return `  ${safeName}: ${value}`
      }),
      ...optionalEntries.map(({ key, value }) => {
        const safeName = isSafeIdentifier(key) ? key : JSON.stringify(key)
        return `  ${safeName}: v.optional(${value})`
      }),
    ]
    return `v.object({\n${lines.join(',\n')},\n})`
  },
  record: (_k, v) => `v.record(v.string(), ${v})`,
  union: (members) => `v.union([${members.join(', ')}])`,
  discriminatedUnion: (disc, members) => `v.variant(${JSON.stringify(disc)}, [${members.join(', ')}])`,
  intersection: (parts) => `v.intersect([${parts.join(', ')}])`,

  optional: (base) => `v.optional(${base})`,
  nullable: (base) => `v.nullable(${base})`,
  default: (base, value) => `v.optional(${base}, ${JSON.stringify(value)})`,
  describe: (base, desc) => `v.pipe(${base}, v.description(${JSON.stringify(desc)}))`,
}

/**
 * Valibot uses `v.pipe(schema, ...actions)` for constraints.
 * If the base is already a pipe, inject the action into it.
 */
function wrapValibotPipe(base: string, action: string): string {
  if (base.startsWith('v.pipe(') && base.endsWith(')')) {
    // Insert action before the closing paren
    return `${base.slice(0, -1)}, ${action})`
  }
  return `v.pipe(${base}, ${action})`
}

// ── ArkType Emitter ────────────────────────────────────

export const arktypeEmitter: SchemaEmitter = {
  importStatement: "import { type } from 'arktype'",
  inferType: (expr) => `typeof ${expr}.infer`,

  string: () => "type('string')",
  number: () => "type('number')",
  int: () => "type('number.integer')",
  boolean: () => "type('boolean')",
  null: () => "type('null')",
  unknown: () => "type('unknown')",

  email: () => "type('string.email')",
  url: () => "type('string.url')",
  uuid: () => "type('string.uuid')",
  datetime: () => "type('string.date.iso')",
  date: () => "type('string.date')",
  ipv4: () => "type('string.ip')",
  ipv6: () => "type('string.ip')",

  min: (base, n) => `${base}.atLeast(${n})`,
  max: (base, n) => `${base}.atMost(${n})`,
  gt: (base, n) => `${base}.moreThan(${n})`,
  lt: (base, n) => `${base}.lessThan(${n})`,
  regex: (base, pattern) => `${base}.matching(/${pattern}/)`,

  literal: (value) => `type(${JSON.stringify(JSON.stringify(value))})`,
  enum: (values) => {
    const members = values.map((v) => JSON.stringify(JSON.stringify(v)))
    return `type(${members.join(' + ' + "' | ' + ")})`
  },
  array: (items) => `${items}.array()`,
  object: (entries) => {
    const lines = entries.map(({ key, value, required }) => {
      const keyStr = required ? JSON.stringify(key) : JSON.stringify(`${key}?`)
      return `  [${keyStr}]: ${value}`
    })
    return `type({\n${lines.join(',\n')},\n})`
  },
  record: (_k, v) => `type({ '[string]': ${v} })`,
  union: (members) => members.reduce((acc, m) => `${acc}.or(${m})`),
  discriminatedUnion: (_disc, members) => members.reduce((acc, m) => `${acc}.or(${m})`),
  intersection: (parts) => parts.reduce((acc, p) => `${acc}.and(${p})`),

  optional: (base) => `${base}.optional()`,
  nullable: (base) => `${base}.or(type('null'))`,
  default: (base, value) => `${base}.default(${JSON.stringify(value)})`,
  describe: (base, desc) => `${base}.describe(${JSON.stringify(desc)})`,
}

// ── Emitter Registry ───────────────────────────────────

const emitters: Record<SchemaTarget, SchemaEmitter> = {
  zod: zodEmitter,
  valibot: valibotEmitter,
  arktype: arktypeEmitter,
}

export function getEmitter(target: SchemaTarget): SchemaEmitter {
  const emitter = emitters[target]
  if (!emitter) throw new Error(`Unknown schema target: ${target}`)
  return emitter
}

// ── Utility ────────────────────────────────────────────

function isSafeIdentifier(s: string): boolean {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(s)
}
