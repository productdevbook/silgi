/**
 * Strict GET method guard — enforce GET for query procedures.
 *
 * Rejects non-GET requests to query procedures with 405 Method Not Allowed.
 * Mutations must use POST. This prevents CSRF on read endpoints.
 *
 * @example
 * ```ts
 * import { strictGetGuard } from "silgi/plugins"
 *
 * const listUsers = k
 *   .$use(strictGetGuard)
 *   .$resolve(({ ctx }) => ctx.db.users.findMany())
 * ```
 */

import { SilgiError } from '../core/error.ts'

import type { GuardDef } from '../types.ts'

/**
 * Guard that rejects non-GET requests. Use on query procedures
 * to enforce RESTful method semantics and prevent CSRF.
 */
export const strictGetGuard: GuardDef<Record<string, unknown>> = {
  kind: 'guard',
  fn: (ctx: Record<string, unknown>) => {
    const method = ctx.method as string | undefined
    // Only block if method info is available and it's not GET/HEAD
    if (method && method !== 'GET' && method !== 'HEAD') {
      throw new SilgiError('METHOD_NOT_ALLOWED', {
        status: 405,
        message: `Expected GET, received ${method}`,
      })
    }
  },
}
