/**
 * devalue codec — rich type serialization.
 *
 * Supports Date, Map, Set, BigInt, undefined, circular refs.
 * 2.7x faster than superjson, 37% smaller output.
 *
 * Use when your RPC procedures return rich JS types
 * that JSON.stringify can't handle.
 */

import { stringify, parse } from 'devalue'

import { sanitizeDecoded } from './sanitize.ts'

export const DEVALUE_CONTENT_TYPE = 'application/x-devalue+json'

/** Serialize a value with devalue (handles Date, Map, Set, BigInt, etc.) */
export function encode(value: unknown): string {
  return stringify(value)
}

/** Deserialize a devalue string back to the original value, sanitized for safety */
export function decode(text: string): unknown {
  return sanitizeDecoded(parse(text))
}

/** Check if request body uses devalue encoding */
export function isDevalue(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  return contentType.includes(DEVALUE_CONTENT_TYPE)
}

/** Check if client accepts devalue responses */
export function acceptsDevalue(acceptHeader: string | null | undefined): boolean {
  if (!acceptHeader) return false
  return acceptHeader.includes(DEVALUE_CONTENT_TYPE)
}
