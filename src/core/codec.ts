/**
 * Response encoding — JSON, MessagePack, devalue.
 *
 * Lazy-loads binary codecs on first non-JSON request.
 */

import { SilgiError, toSilgiError } from './error.ts'
import { ValidationError } from './schema.ts'
import { stringifyJSON } from './utils.ts'

// Lazy-loaded codecs — resolved on first non-JSON request
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

export type ResponseFormat = 'json' | 'msgpack' | 'devalue'

/** Detect response format from Accept header */
export function detectResponseFormat(request: Request): ResponseFormat {
  const accept = request.headers.get('accept')
  if (!accept) return 'json'
  if (accept.includes('msgpack')) return 'msgpack'
  if (accept.includes('x-devalue')) return 'devalue'
  return 'json'
}

/** Encode data into a Response with the given format */
export async function encodeResponse(
  data: unknown,
  status: number,
  format: ResponseFormat,
  extraHeaders?: Record<string, string>,
): Promise<Response> {
  switch (format) {
    case 'msgpack': {
      _msgpack ??= await import('../codec/msgpack.ts')
      return new Response(_msgpack.encode(data), {
        status,
        headers: { 'content-type': _msgpack.MSGPACK_CONTENT_TYPE, ...extraHeaders },
      })
    }
    case 'devalue': {
      _devalue ??= await import('../codec/devalue.ts')
      return new Response(_devalue.encode(data), {
        status,
        headers: { 'content-type': _devalue.DEVALUE_CONTENT_TYPE, ...extraHeaders },
      })
    }
    default:
      return new Response(stringifyJSON(data), {
        status,
        headers: { 'content-type': 'application/json', ...extraHeaders },
      })
  }
}

/** Build error Response from any thrown error */
export function makeErrorResponse(error: unknown, format: ResponseFormat): Response | Promise<Response> {
  if (error instanceof ValidationError) {
    return encodeResponse({ code: 'BAD_REQUEST', status: 400, message: error.message, data: { issues: error.issues } }, 400, format)
  }
  if (error instanceof SyntaxError) {
    return encodeResponse({ code: 'BAD_REQUEST', status: 400, message: 'Invalid JSON body' }, 400, format)
  }
  const e = error instanceof SilgiError ? error : toSilgiError(error)
  return encodeResponse(e.toJSON(), e.status, format)
}
