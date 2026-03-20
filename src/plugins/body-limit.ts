/**
 * Body limit guard — reject oversized request bodies.
 *
 * Throws TOO_LARGE (413) when the Content-Length header exceeds the limit.
 *
 * @example
 * ```ts
 * import { bodyLimitGuard } from "katman/plugins"
 *
 * const upload = k
 *   .$use(bodyLimitGuard({ maxBytes: 5 * 1024 * 1024 })) // 5 MB
 *   .$resolve(({ input }) => processUpload(input))
 * ```
 */

import { KatmanError } from '../core/error.ts'

import type { GuardDef } from '../types.ts'

export interface BodyLimitOptions {
  /** Maximum body size in bytes. Default: 1_048_576 (1 MB) */
  maxBytes?: number
  /** Custom error message. */
  message?: string
}

/**
 * Create a guard that rejects requests with bodies larger than `maxBytes`.
 * Checks the Content-Length header — zero overhead for GET requests.
 */
export function bodyLimitGuard(options: BodyLimitOptions = {}): GuardDef<Record<string, unknown>> {
  const { maxBytes = 1_048_576, message = 'Request body too large' } = options

  return {
    kind: 'guard',
    fn: (ctx: Record<string, unknown>) => {
      const headers = ctx.headers as Record<string, string> | undefined
      if (!headers) return

      const cl = headers['content-length']
      if (!cl) return

      const size = Number.parseInt(cl, 10)
      if (Number.isNaN(size)) return

      if (size > maxBytes) {
        throw new KatmanError('PAYLOAD_TOO_LARGE', {
          status: 413,
          message,
          data: { maxBytes, receivedBytes: size },
        })
      }
    },
  }
}
