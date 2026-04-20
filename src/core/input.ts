/**
 * Request input parsing — JSON, MessagePack, devalue, query string.
 */

// Lazy-loaded codecs
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

import { SilgiError } from './error.ts'

/** Max allowed size for GET ?data= parameter (bytes). Prevents JSON bomb via URL. */
const MAX_QUERY_DATA_LENGTH = 8192

/** Parse request input from body or query string */
export async function parseInput(request: Request, url: string, qMark: number): Promise<unknown> {
  if (request.method === 'GET' || !request.body) {
    if (qMark !== -1) {
      const searchStr = url.slice(qMark + 1)
      const dataIdx = searchStr.indexOf('data=')
      if (dataIdx !== -1) {
        const valueStart = dataIdx + 5
        const valueEnd = searchStr.indexOf('&', valueStart)
        const encoded = valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
        if (encoded.length > MAX_QUERY_DATA_LENGTH) {
          throw new SilgiError('BAD_REQUEST', { message: 'Query data parameter too large' })
        }
        return JSON.parse(decodeURIComponent(encoded))
      }
    }
    return undefined
  }

  const ct = request.headers.get('content-type')

  // Binary codecs
  if (ct) {
    if (ct.includes('msgpack')) {
      _msgpack ??= await import('../codec/msgpack.ts')
      const buf = new Uint8Array(await request.arrayBuffer())
      return buf.length > 0 ? _msgpack.decode(buf) : undefined
    }
    if (ct.includes('x-devalue')) {
      _devalue ??= await import('../codec/devalue.ts')
      const text = await request.text()
      return text ? _devalue.decode(text) : undefined
    }
  }

  // JSON body — same semantics across runtimes:
  //   empty body → undefined (input schema sees `undefined` / default)
  //   non-empty malformed body → throw BAD_REQUEST
  //
  // Bun's `request.json()` is a fast path but throws a generic SyntaxError
  // on BOTH empty and malformed bodies, so we can't blanket-swallow. Read
  // text first to distinguish the two cases — Bun's text() is also fast.
  const text = await request.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new SilgiError('BAD_REQUEST', { message: 'Malformed JSON body' })
  }
}
