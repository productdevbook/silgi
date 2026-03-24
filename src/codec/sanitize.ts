/**
 * Shared sanitizer for decoded codec values.
 *
 * Strips dangerous types (RegExp → ReDoS, Error → info disclosure)
 * and removes __proto__ keys (prototype pollution) from decoded payloads.
 * Used by both devalue and msgpack codecs.
 */

export function sanitizeDecoded(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value

  // Strip dangerous types
  if (value instanceof RegExp) return String(value)
  if (value instanceof Error) return { message: value.message }
  if (value instanceof Date) return value

  // Recurse into arrays
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      value[i] = sanitizeDecoded(value[i])
    }
    return value
  }

  // Recurse into Maps (sanitize both keys and values)
  if (value instanceof Map) {
    const clean = new Map()
    for (const [k, v] of value) {
      clean.set(sanitizeDecoded(k), sanitizeDecoded(v))
    }
    return clean
  }

  // Recurse into Sets
  if (value instanceof Set) {
    const clean = new Set()
    for (const v of value) {
      clean.add(sanitizeDecoded(v))
    }
    return clean
  }

  // Recurse into plain objects — strip __proto__ keys
  const proto = Object.getPrototypeOf(value)
  if (proto === Object.prototype || proto === null) {
    const obj = value as Record<string, unknown>
    for (const key of Object.keys(obj)) {
      if (key === '__proto__') {
        delete obj[key]
      } else {
        obj[key] = sanitizeDecoded(obj[key])
      }
    }
  }

  return value
}
