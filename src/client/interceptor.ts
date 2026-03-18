/**
 * Client interceptors — middleware-style hooks on the client link.
 *
 * Wrap any ClientLink with interceptors to add logging, metrics,
 * token refresh, or request transformation.
 *
 * @example
 * ```ts
 * import { withInterceptors } from "katman/client"
 *
 * const link = withInterceptors(baseLink, {
 *   onRequest({ path, input }) {
 *     console.log(`-> ${path.join("/")}`, input)
 *   },
 *   onResponse({ path, output, durationMs }) {
 *     console.log(`<- ${path.join("/")} (${durationMs}ms)`)
 *   },
 *   onError({ path, error }) {
 *     console.error(`!! ${path.join("/")}`, error)
 *   },
 * })
 * ```
 */

import type { ClientLink, ClientContext, ClientOptions } from "./types.ts";

export interface ClientInterceptors<TClientContext extends ClientContext = ClientContext> {
  /** Called before every request. Can modify input or options. */
  onRequest?: (event: {
    path: readonly string[];
    input: unknown;
    options: ClientOptions<TClientContext>;
  }) => void | Promise<void>;

  /** Called after a successful response. */
  onResponse?: (event: {
    path: readonly string[];
    input: unknown;
    output: unknown;
    durationMs: number;
  }) => void | Promise<void>;

  /** Called when a request fails. */
  onError?: (event: {
    path: readonly string[];
    input: unknown;
    error: unknown;
  }) => void | Promise<void>;
}

/**
 * Wrap a ClientLink with interceptor hooks.
 * Returns a new link that calls the interceptors around the original.
 */
export function withInterceptors<TClientContext extends ClientContext = ClientContext>(
  link: ClientLink<TClientContext>,
  interceptors: ClientInterceptors<TClientContext>,
): ClientLink<TClientContext> {
  return {
    async call(
      path: readonly string[],
      input: unknown,
      options: ClientOptions<TClientContext>,
    ): Promise<unknown> {
      if (interceptors.onRequest) {
        await interceptors.onRequest({ path, input, options });
      }

      const t0 = performance.now();

      try {
        const output = await link.call(path, input, options);

        if (interceptors.onResponse) {
          await interceptors.onResponse({
            path,
            input,
            output,
            durationMs: performance.now() - t0,
          });
        }

        return output;
      } catch (error) {
        if (interceptors.onError) {
          await interceptors.onError({ path, input, error });
        }
        throw error;
      }
    },
  };
}
