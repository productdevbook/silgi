/**
 * ofetch-based RPC transport — v2 client link.
 *
 * Uses ofetch for: retry, timeout, interceptors, auto-JSON.
 * Replaces manual fetch + retry/dedupe plugins with a single link.
 */

import { ofetch, type FetchOptions, type FetchContext, FetchError } from "ofetch";
import type { ClientLink, ClientContext, ClientOptions } from "../../types.ts";
import { KatmanError, isKatmanErrorJSON, fromKatmanErrorJSON, isErrorStatus } from "../../../core/error.ts";

export interface KatmanLinkOptions<TClientContext extends ClientContext = ClientContext> {
  /** Server base URL (e.g. "http://localhost:3000") */
  url: string;

  /** Static headers or dynamic header factory */
  headers?: Record<string, string> | ((options: ClientOptions<TClientContext>) => Record<string, string>);

  /** Retry count for failed requests (default: 1 for queries, 0 for mutations) */
  retry?: number | false;

  /** Retry delay in ms, or function for backoff (default: 0) */
  retryDelay?: number | ((ctx: FetchContext) => number);

  /** Timeout in ms (default: 30000) */
  timeout?: number;

  /** ofetch interceptors */
  onRequest?: FetchOptions["onRequest"];
  onResponse?: FetchOptions["onResponse"];
  onRequestError?: FetchOptions["onRequestError"];
  onResponseError?: FetchOptions["onResponseError"];
}

/**
 * Create a Katman client link powered by ofetch.
 *
 * @example
 * ```ts
 * import { createClient } from "katman/client"
 * import { createLink } from "katman/client/ofetch"
 *
 * const link = createLink({ url: "http://localhost:3000" })
 * const client = createClient<AppRouter>(link)
 * const users = await client.users.list({ limit: 10 })
 * ```
 */
export function createLink<TClientContext extends ClientContext = ClientContext>(
  options: KatmanLinkOptions<TClientContext>,
): ClientLink<TClientContext> {
  const baseUrl = options.url.endsWith("/") ? options.url.slice(0, -1) : options.url;
  const defaultTimeout = options.timeout ?? 30_000;
  const defaultRetry = options.retry;
  const defaultRetryDelay = options.retryDelay ?? 0;

  return {
    async call(path, input, callOptions) {
      const urlPath = path.join("/");
      const url = `${baseUrl}/${urlPath}`;

      // Resolve headers
      const headers: Record<string, string> = {
        ...(typeof options.headers === "function"
          ? options.headers(callOptions)
          : options.headers),
      };

      // Build request body (POST with JSON)
      const hasInput = input !== undefined && input !== null;
      const body = hasInput ? input : undefined;

      try {
        const data = await ofetch(url, {
          method: "POST",
          headers,
          body,
          signal: callOptions.signal,
          timeout: defaultTimeout,
          retry: defaultRetry ?? 0,
          retryDelay: defaultRetryDelay,
          // Don't throw on error status — we handle KatmanError ourselves
          ignoreResponseError: true,
          // Interceptors
          onRequest: options.onRequest,
          onResponse: options.onResponse,
          onRequestError: options.onRequestError,
          onResponseError: options.onResponseError,
          // Custom response handling
          parseResponse(text) {
            if (!text) return undefined;
            try { return JSON.parse(text); } catch { return text; }
          },
        });

        // Check if the raw response was an error (we used ignoreResponseError)
        // ofetch still parses the body, so we check the shape
        if (isKatmanErrorJSON(data)) {
          throw fromKatmanErrorJSON(data);
        }

        return data;
      } catch (error) {
        // Re-throw KatmanError as-is
        if (error instanceof KatmanError) throw error;

        // Convert FetchError to KatmanError
        if (error instanceof FetchError) {
          const responseData = error.data;
          if (isKatmanErrorJSON(responseData)) {
            throw fromKatmanErrorJSON(responseData);
          }
          throw new KatmanError("INTERNAL_SERVER_ERROR", {
            status: error.status ?? 500,
            message: error.message,
            data: responseData,
          });
        }

        throw error;
      }
    },
  };
}
