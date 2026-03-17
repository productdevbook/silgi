/**
 * Dedupe Plugin — collapses identical concurrent requests into one.
 *
 * If two calls have the same path and serialized input within
 * the same microtask, only one actual request is sent.
 * All callers receive the same response.
 */

import type { ClientLink, ClientContext, ClientOptions } from "../types.ts";
import { stringifyJSON } from "../../core/utils.ts";

export interface DedupeOptions {
  /** Custom key function. Default: JSON.stringify(path + input) */
  keyFn?: (path: readonly string[], input: unknown) => string;
}

export function withDedupe<TClientContext extends ClientContext>(
  link: ClientLink<TClientContext>,
  options: DedupeOptions = {},
): ClientLink<TClientContext> {
  const inflight = new Map<string, Promise<unknown>>();
  const keyFn = options.keyFn ?? ((path, input) =>
    stringifyJSON({ path, input }));

  return {
    call(path, input, callOptions) {
      const key = keyFn(path, input);

      const existing = inflight.get(key);
      if (existing) return existing;

      const promise = link.call(path, input, callOptions).finally(() => {
        inflight.delete(key);
      });

      inflight.set(key, promise);
      return promise;
    },
  };
}
