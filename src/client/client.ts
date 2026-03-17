/**
 * Client factory — creates a type-safe client from a link.
 *
 * Key optimization over oRPC:
 * - Sub-proxies are cached in a Map (oRPC creates new Proxy per access)
 * - Path accumulation uses frozen arrays (V8 fast path)
 * - preventNativeAwait is built into the proxy handler
 */

import type { ClientLink, ClientContext, ClientOptions, NestedClient } from "./types.ts";

export function createClient<T extends NestedClient<TClientContext>, TClientContext extends ClientContext = Record<never, never>>(
  link: ClientLink<TClientContext>,
): T {
  return createClientProxy<T, TClientContext>(link, []);
}

function createClientProxy<T, TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  path: readonly string[],
): T {
  // Cache child proxies for O(1) repeated access
  const cache = new Map<string, unknown>();

  const procedureClient = (input: unknown, options?: ClientOptions<TClientContext>) =>
    link.call(path, input, options ?? ({} as ClientOptions<TClientContext>));

  return new Proxy(procedureClient, {
    get(_target, prop) {
      // Prevent native await
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return undefined;

      let cached = cache.get(prop);
      if (!cached) {
        // Freeze the child path for V8 optimization
        const childPath = Object.freeze([...path, prop]);
        cached = createClientProxy(link, childPath);
        cache.set(prop, cached);
      }
      return cached;
    },
    apply(_target, _thisArg, args) {
      return procedureClient(args[0], args[1]);
    },
  }) as T;
}

/**
 * Safe client wrapper — returns [error, data] tuples instead of throwing.
 */
export interface SafeResult<TOutput, TError> {
  error: TError | null;
  data: TOutput | undefined;
  isError: boolean;
  isSuccess: boolean;
}

export async function safe<TOutput, TError = unknown>(
  promise: Promise<TOutput>,
): Promise<SafeResult<TOutput, TError>> {
  try {
    const data = await promise;
    return { error: null, data, isError: false, isSuccess: true };
  } catch (error) {
    return { error: error as TError, data: undefined, isError: true, isSuccess: false };
  }
}
