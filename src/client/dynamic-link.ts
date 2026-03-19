/**
 * DynamicLink — select a link at runtime based on context.
 *
 * Useful for routing requests to different backends based on
 * feature flags, auth state, caching strategy, or environment.
 *
 * @example
 * ```ts
 * import { DynamicLink } from "katman/client"
 *
 * const link = new DynamicLink((path, input, options) => {
 *   if (options.context?.cache) return cachedLink
 *   if (path[0] === "admin") return adminLink
 *   return defaultLink
 * })
 *
 * const client = createClient<AppRouter>(link)
 * ```
 */

import type { ClientLink, ClientContext, ClientOptions } from './types.ts'

export type LinkSelector<TClientContext extends ClientContext = ClientContext> = (
  path: readonly string[],
  input: unknown,
  options: ClientOptions<TClientContext>,
) => ClientLink<TClientContext>

/**
 * A link that delegates to other links based on a selector function.
 * The selector runs on every call, so it can use dynamic state.
 */
export class DynamicLink<TClientContext extends ClientContext = ClientContext> implements ClientLink<TClientContext> {
  #selector: LinkSelector<TClientContext>

  constructor(selector: LinkSelector<TClientContext>) {
    this.#selector = selector
  }

  call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown> {
    const link = this.#selector(path, input, options)
    return link.call(path, input, options)
  }
}
