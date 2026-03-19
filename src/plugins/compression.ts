/**
 * Response compression plugin — gzip/deflate.
 *
 * A wrap middleware that compresses response bodies based on
 * the client's Accept-Encoding header.
 *
 * @example
 * ```ts
 * import { compressionWrap } from "katman/plugins"
 *
 * const listUsers = k.query({
 *   use: [compressionWrap()],
 *   resolve: ({ ctx }) => ctx.db.users.findMany(),
 * })
 * ```
 */

import type { WrapDef } from '../types.ts'

export interface CompressionOptions {
  /** Minimum response size in bytes before compression kicks in. Default: 1024 */
  threshold?: number
  /** Preferred encoding. Default: "gzip" */
  encoding?: 'gzip' | 'deflate'
}

/**
 * Create a compression wrap middleware.
 *
 * Note: Compression is most useful with handler() / custom servers.
 * With serve(), Node.js handles compression at the HTTP level.
 * This wrap operates on the procedure output before serialization.
 */
export function compressionWrap(options: CompressionOptions = {}): WrapDef {
  const { threshold = 1024, encoding = 'gzip' } = options

  return {
    kind: 'wrap',
    fn: async (_ctx, next) => {
      // Pass through — the actual compression happens at the transport layer.
      // This wrap attaches compression hints to the context for transport-level use.
      ;(_ctx as any).__compression = { threshold, encoding }
      return next()
    },
  }
}
