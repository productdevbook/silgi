/**
 * Error constructor map — creates typed errors from the error map.
 *
 * Returns a Proxy that creates KatmanError instances for each error code,
 * with pre-filled status and message from the error map.
 */

import { KatmanError, type KatmanErrorOptions } from "../core/error.ts";
import type { ErrorMap } from "../contract/error.ts";

export type ErrorConstructorMap<TErrorMap extends ErrorMap> = {
  [K in keyof TErrorMap]: (options?: KatmanErrorOptions) => KatmanError<K & string>;
};

export function createErrorConstructorMap<TErrorMap extends ErrorMap>(
  errorMap: TErrorMap,
): ErrorConstructorMap<TErrorMap> {
  return new Proxy({} as ErrorConstructorMap<TErrorMap>, {
    get(_target, code: string) {
      return (options?: KatmanErrorOptions) => {
        const config = errorMap[code];
        return new KatmanError(code, {
          status: options?.status ?? config?.status,
          message: options?.message ?? config?.message,
          data: options?.data,
          cause: options?.cause,
          defined: config !== undefined,
        });
      };
    },
  });
}
