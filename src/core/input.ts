/**
 * Request input parsing — JSON, MessagePack, devalue, query string.
 */

// Lazy-loaded codecs
let _msgpack: typeof import('../codec/msgpack.ts') | undefined
let _devalue: typeof import('../codec/devalue.ts') | undefined

const isBun = typeof globalThis.Bun !== 'undefined'

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

  // JSON body
  if (isBun) {
    try {
      return await request.json()
    } catch {
      return undefined
    }
  }
  const text = await request.text()
  return text ? JSON.parse(text) : undefined
}
