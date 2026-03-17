/**
 * Simple CSRF Protection plugin.
 *
 * Requires a custom header (default: x-csrf-token: katman) on all requests.
 * Browsers don't add custom headers to cross-origin form submissions,
 * so this ensures the request came from JavaScript.
 */

import type { StandardHandlerPlugin, StandardHandlerOptions } from "../adapters/standard/handler.ts";
import type { Context } from "../../core/types.ts";
import { KatmanError } from "../../core/error.ts";

export interface CSRFOptions {
  headerName?: string;
  headerValue?: string;
}

export class CSRFPlugin<TContext extends Context = Context>
  implements StandardHandlerPlugin<TContext>
{
  readonly order = 8_000_000;
  #headerName: string;
  #headerValue: string;

  constructor(options: CSRFOptions = {}) {
    this.#headerName = options.headerName ?? "x-csrf-token";
    this.#headerValue = options.headerValue ?? "katman";
  }

  init(options: StandardHandlerOptions<TContext>): void {
    const headerName = this.#headerName;
    const headerValue = this.#headerValue;

    options.clientInterceptors ??= [];
    options.clientInterceptors.push(async (opts: any) => {
      const request = opts.request as { headers: Record<string, string | string[] | undefined> };
      if (request) {
        const val = request.headers[headerName];
        const actual = Array.isArray(val) ? val[0] : val;
        if (actual !== headerValue) {
          throw new KatmanError("FORBIDDEN", {
            message: "CSRF token missing or invalid",
          });
        }
      }
      return opts.next();
    });
  }
}
