/**
 * MessagePack codec — binary transport for Silgi.
 *
 * ~50% smaller payloads vs JSON. Uses msgpackr with record extension
 * for fast encoding of repeated object shapes.
 */

import { Packr } from 'msgpackr'

import { sanitizeDecoded } from './sanitize.ts'

export const MSGPACK_CONTENT_TYPE = 'application/x-msgpack'

/**
 * Stateless msgpack codec — for request/response (no connection persistence).
 * Records disabled for cross-request compatibility.
 */
const encoder = new Packr({
  useRecords: false,
  moreTypes: true, // Date, Set, Map for outbound responses
  int64AsType: 'number',
})

const decoder = new Packr({
  useRecords: false,
  moreTypes: false, // No Error/RegExp from untrusted input
  int64AsType: 'number',
})

/** Encode a value to MessagePack binary (usable as Response body) */
export function encode(value: unknown): BodyInit {
  const buf = encoder.pack(value)
  // Return ArrayBuffer slice — compatible with Response constructor
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/** Decode a MessagePack Buffer to a value (safe for untrusted input) */
export function decode(buf: Buffer | Uint8Array): unknown {
  return sanitizeDecoded(decoder.unpack(buf))
}

/** Check if a request accepts msgpack */
export function acceptsMsgpack(acceptHeader: string | null | undefined): boolean {
  if (!acceptHeader) return false
  return acceptHeader.includes(MSGPACK_CONTENT_TYPE) || acceptHeader.includes('application/msgpack')
}

/** Check if request body is msgpack */
export function isMsgpack(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  return contentType.includes(MSGPACK_CONTENT_TYPE) || contentType.includes('application/msgpack')
}
