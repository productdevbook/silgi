/**
 * Request input parsing — JSON, MessagePack, devalue, query string.
 */

// Lazy-loaded codecs
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

import { SilgiError } from './error.ts'

/** Max allowed size for GET ?data= parameter (bytes). Prevents JSON bomb via URL. */
const MAX_QUERY_DATA_LENGTH = 8192

/**
 * Find the value of the `data=` query parameter by key, not by substring.
 *
 * The previous `indexOf('data=')` implementation matched `userdata=...`,
 * `xdata=...`, or any other key ending in `data` — silently returning the
 * wrong value. This scans for `data=` at a parameter boundary (either the
 * first param or after `&`).
 */
function findDataParam(searchStr: string): string | null {
  let i = 0
  while (i < searchStr.length) {
    if (searchStr.startsWith('data=', i)) {
      const valueStart = i + 5
      const valueEnd = searchStr.indexOf('&', valueStart)
      return valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
    }
    const nextAmp = searchStr.indexOf('&', i)
    if (nextAmp === -1) return null
    i = nextAmp + 1
  }
  return null
}

/** Parse request input from body or query string */
export async function parseInput(request: Request, url: string, qMark: number): Promise<unknown> {
  if (request.method === 'GET' || !request.body) {
    if (qMark !== -1) {
      const encoded = findDataParam(url.slice(qMark + 1))
      if (encoded !== null) {
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
