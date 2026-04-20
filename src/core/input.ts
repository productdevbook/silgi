/**
 * Request input parsing
 * -----------------------
 *
 * Pulls the RPC input payload out of an incoming `Request` and returns
 * it in its decoded form. The shape of the input depends on how the
 * client chose to send it:
 *
 *   - `GET` / no-body  — JSON-encoded, URL-escaped, on `?data=` query.
 *   - `content-type: application/msgpack` — binary, via the msgpack codec.
 *   - `content-type: application/x-devalue` — text, via devalue.
 *   - anything else (typically JSON) — JSON body.
 *
 * Empty bodies always resolve to `undefined` so that a procedure with
 * no input, or one whose schema allows `undefined`, works without the
 * client having to send a payload at all. Malformed non-empty bodies
 * throw `BAD_REQUEST` with a message the client can show to a user.
 */

import { SilgiError } from './error.ts'

// ─── Lazy codec imports ───────────────────────────────────────────────

/**
 * The msgpack and devalue codecs are pulled in on first use so that a
 * handler that only ever sees JSON never pays the cost of loading
 * them. `Promise`-cached at module scope: once the first request
 * triggers the import, subsequent calls share the resolved module.
 *
 * Module-global is intentional and safe here — the cached value is a
 * reference to an immutable ES module, not user data. Two silgi
 * instances in the same process legitimately share it.
 */
let msgpackModule: typeof import('../codec/msgpack.ts') | undefined
let devalueModule: typeof import('../codec/devalue.ts') | undefined

// ─── Query string helpers ────────────────────────────────────────────

/** Max bytes permitted in the `?data=` query param. Shields against JSON-bomb payloads in a URL. */
const MAX_QUERY_DATA_LENGTH = 8192

/**
 * Find the value of the `data=` query parameter by key, not by substring.
 *
 * A naive `searchStr.indexOf('data=')` matches `userdata=`, `mydata=`,
 * or any other key that merely ends in `data`, and silently returns
 * the wrong value. This scans for `data=` only at a parameter
 * boundary — i.e. at the start of the search string, or right after
 * an `&`.
 */
function findDataParam(searchStr: string): string | null {
  let i = 0
  while (i < searchStr.length) {
    if (searchStr.startsWith('data=', i)) {
      const valueStart = i + 'data='.length
      const valueEnd = searchStr.indexOf('&', valueStart)
      return valueEnd === -1 ? searchStr.slice(valueStart) : searchStr.slice(valueStart, valueEnd)
    }
    const nextAmp = searchStr.indexOf('&', i)
    if (nextAmp === -1) return null
    i = nextAmp + 1
  }
  return null
}

/**
 * Decode the `?data=` query param as JSON. Returns `undefined` when
 * the query is missing or has no `data=` field. Throws `BAD_REQUEST`
 * when the payload is oversized or unparsable.
 */
function decodeQueryInput(url: string, qMark: number): unknown {
  if (qMark === -1) return undefined
  const encoded = findDataParam(url.slice(qMark + 1))
  if (encoded === null) return undefined

  if (encoded.length > MAX_QUERY_DATA_LENGTH) {
    throw new SilgiError('BAD_REQUEST', { message: 'Query data parameter too large' })
  }
  return JSON.parse(decodeURIComponent(encoded))
}

// ─── Body decoders ────────────────────────────────────────────────────

/**
 * Decode a MessagePack-encoded request body. Empty bodies resolve to
 * `undefined` (procedures with no input work without a payload).
 */
async function decodeMsgpackBody(request: Request): Promise<unknown> {
  msgpackModule ??= await import('../codec/msgpack.ts')
  const buf = new Uint8Array(await request.arrayBuffer())
  return buf.length > 0 ? msgpackModule.decode(buf) : undefined
}

/** Decode a devalue-encoded request body. Empty bodies resolve to `undefined`. */
async function decodeDevalueBody(request: Request): Promise<unknown> {
  devalueModule ??= await import('../codec/devalue.ts')
  const text = await request.text()
  return text ? devalueModule.decode(text) : undefined
}

/**
 * Decode a JSON-encoded request body.
 *
 * Empty bodies resolve to `undefined` so the input schema sees the
 * same value whether or not the client sent a body at all. Malformed
 * non-empty bodies throw `BAD_REQUEST`.
 *
 * Why we `text()` first and then `JSON.parse` — instead of
 * `request.json()`: Bun's `request.json()` is a fast path, but it
 * throws a generic `SyntaxError` for **both** empty and malformed
 * bodies, so we cannot tell them apart. Reading text first keeps the
 * two cases distinct (and Bun's `text()` is also fast).
 */
async function decodeJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new SilgiError('BAD_REQUEST', { message: 'Malformed JSON body' })
  }
}

// ─── Entry point ──────────────────────────────────────────────────────

/**
 * Decode the input payload off a Fetch `Request`.
 *
 * @param request The incoming request.
 * @param url     The full request URL (reused by the caller — we avoid
 *                re-parsing it here).
 * @param qMark   Byte offset of the `?` in `url`, or `-1` when absent.
 *
 * @returns The decoded input value, or `undefined` when the request
 *          carries no payload.
 */
export async function parseInput(request: Request, url: string, qMark: number): Promise<unknown> {
  // No body path: GET requests, or anything else without a body, are
  // expected to carry their input on `?data=`.
  if (request.method === 'GET' || !request.body) {
    return decodeQueryInput(url, qMark)
  }

  const contentType = request.headers.get('content-type')
  if (contentType) {
    if (contentType.includes('msgpack')) return decodeMsgpackBody(request)
    if (contentType.includes('x-devalue')) return decodeDevalueBody(request)
  }

  return decodeJsonBody(request)
}
