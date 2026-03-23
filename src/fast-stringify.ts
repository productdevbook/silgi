/**
 * Schema-aware fast JSON stringifier.
 *
 * Compiles a Zod schema into a specialized stringify function
 * at procedure definition time. Avoids JSON.stringify overhead:
 * - No property enumeration
 * - No type detection per value
 * - Pre-built template string
 *
 * Inspired by fast-json-stringify (Fastify), but tighter because
 * we control the schema format (Standard Schema / Zod).
 *
 * Benchmark: 2-5x faster than JSON.stringify for typical API responses.
 */

import type { AnySchema } from './core/schema.ts'

export type FastStringify = (value: unknown) => string

/**
 * Compile a schema into a fast stringify function.
 * Falls back to JSON.stringify for unknown/complex schemas.
 */
export function compileStringify(schema: AnySchema | null): FastStringify {
  if (!schema) return JSON.stringify

  const def = getZodDef(schema)
  if (!def) return JSON.stringify

  const fn = compileType(def)
  return fn ?? JSON.stringify
}

// ── Zod internal access ─────────────────────────────

function getZodDef(schema: any): any {
  return schema?._zod?.def ?? schema?._def
}

// ── Compiler ────────────────────────────────────────

function compileType(def: any): FastStringify | undefined {
  const type = def.type ?? def.typeName

  switch (type) {
    case 'string':
    case 'ZodString':
      return (v) => '"' + escapeString(v as string) + '"'

    case 'number':
    case 'ZodNumber':
    case 'int':
      return (v) => String(v)

    case 'boolean':
    case 'ZodBoolean':
      return (v) => (v ? 'true' : 'false')

    case 'null':
    case 'ZodNull':
      return () => 'null'

    case 'literal':
    case 'ZodLiteral': {
      const values = def.values ?? [def.value]
      const cached = JSON.stringify(values[0])
      return () => cached
    }

    case 'object':
    case 'ZodObject':
      return compileObject(def)

    case 'array':
    case 'ZodArray':
      // V8's native JSON.stringify is faster for arrays (SIMD-optimized C++)
      return undefined

    case 'optional':
    case 'ZodOptional':
    case 'nullable':
    case 'ZodNullable': {
      const inner = compileType(getZodDef(def.innerType ?? def.wrapped))
      if (!inner) return undefined
      return (v) => (v == null ? 'null' : inner(v))
    }

    case 'default':
    case 'ZodDefault': {
      const inner = compileType(getZodDef(def.innerType ?? def.wrapped))
      return inner ?? undefined
    }

    default:
      return undefined // fallback to JSON.stringify
  }
}

function compileObject(def: any): FastStringify | undefined {
  const shape = typeof def.shape === 'function' ? def.shape() : def.shape
  if (!shape) return undefined

  const entries = Object.entries(shape)
  if (entries.length === 0) return () => '{}'
  if (entries.length > 20) return undefined // too many props, fallback

  // Pre-compile each property stringifier
  const propCompilers: Array<{
    key: string
    jsonKey: string // pre-escaped key
    stringify: FastStringify
    optional: boolean
  }> = []

  for (const [key, propSchema] of entries) {
    const propDef = getZodDef(propSchema)
    if (!propDef) return undefined // can't compile this shape

    const propType = propDef.type ?? propDef.typeName
    const isOptional =
      propType === 'optional' || propType === 'ZodOptional' || propType === 'nullable' || propType === 'ZodNullable'

    const propFn = compileType(propDef)
    if (!propFn) return undefined // can't compile this property

    propCompilers.push({
      key,
      jsonKey: '"' + escapeString(key) + '":',
      stringify: propFn,
      optional: isOptional,
    })
  }

  // No optional properties → simpler fast path
  const allRequired = propCompilers.every((p) => !p.optional)

  if (allRequired && propCompilers.length <= 8) {
    // ULTRA FAST: unrolled, no loop, no conditionals
    return buildUnrolledObjectFn(propCompilers)
  }

  // General case with optional handling
  return (obj: any) => {
    let result = '{'
    let first = true
    for (const prop of propCompilers) {
      const val = obj[prop.key]
      if (prop.optional && val === undefined) continue
      if (!first) result += ','
      result += prop.jsonKey + prop.stringify(val)
      first = false
    }
    return result + '}'
  }
}

function buildUnrolledObjectFn(
  props: Array<{ key: string; jsonKey: string; stringify: FastStringify }>,
): FastStringify {
  // True unrolling via code generation — no loop at runtime.
  // For { id: number, name: string } generates:
  //   (obj) => '{"id":' + s0(obj.id) + ',"name":' + s1(obj.name) + '}'
  // where s0, s1 are pre-compiled stringifiers passed via closure.
  const fns = props.map((p) => p.stringify)
  const keys = props.map((p) => p.key)

  // Build concatenation expression using JSON.stringify for JS-safe string literals
  // (handles single quotes, backslashes, and unicode in property keys)
  let expr = `return '{'`
  for (let i = 0; i < props.length; i++) {
    const sep = i > 0 ? ',' : ''
    expr += `+${JSON.stringify(sep + props[i]!.jsonKey)}+f[${i}](o[k[${i}]])`
  }
  expr += `+'}'`

  // eslint-disable-next-line no-new-func -- JIT-compiled stringify, runs at init time
  return new Function('f', 'k', `return function(o){${expr}}`)(fns, keys) as FastStringify
}

// ── String escaping ─────────────────────────────────

const ESCAPE_CHARS: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

function escapeString(str: string): string {
  // Fast path: no special chars (very common for names, emails, etc.)
  let needsEscape = false
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i)
    if (code < 32 || code === 34 || code === 92) {
      needsEscape = true
      break
    }
  }
  if (!needsEscape) return str

  // Slow path: escape special characters
  let result = ''
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    const escaped = ESCAPE_CHARS[ch]
    if (escaped) {
      result += escaped
    } else if (str.charCodeAt(i) < 32) {
      result += '\\u' + str.charCodeAt(i).toString(16).padStart(4, '0')
    } else {
      result += ch
    }
  }
  return result
}
