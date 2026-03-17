/**
 * Error map types for contract-defined typed errors.
 */

import type { AnySchema, InferSchemaOutput } from "../core/schema.ts";
import type { KatmanError } from "../core/error.ts";
import { validateSchema } from "../core/schema.ts";

export interface ErrorMapItem<TDataSchema extends AnySchema = AnySchema> {
  status?: number;
  message?: string;
  data?: TDataSchema;
}

export type ErrorMap = Record<string, ErrorMapItem<AnySchema> | undefined>;

/** Merge two error maps — right side wins on conflicts */
export type MergedErrorMap<T1 extends ErrorMap, T2 extends ErrorMap> = Omit<T1, keyof T2> & T2;

export function mergeErrorMap<T1 extends ErrorMap, T2 extends ErrorMap>(
  a: T1,
  b: T2,
): MergedErrorMap<T1, T2> {
  return { ...a, ...b } as MergedErrorMap<T1, T2>;
}

/** Extract a union of typed KatmanError from an error map */
export type ErrorFromErrorMap<TErrorMap extends ErrorMap> = {
  [K in keyof TErrorMap]: TErrorMap[K] extends ErrorMapItem<infer TDataSchema>
    ? KatmanError<
        K & string,
        TDataSchema extends AnySchema ? InferSchemaOutput<TDataSchema> : undefined
      >
    : never;
}[keyof TErrorMap];

/**
 * Validate a KatmanError against an error map.
 * If the error matches a defined code+status, validate its data and mark defined=true.
 */
export async function validateKatmanError(
  errorMap: ErrorMap,
  error: KatmanError,
): Promise<KatmanError> {
  const entry = errorMap[error.code];
  if (!entry) {
    return Object.assign(error, { defined: false });
  }

  if (entry.status && entry.status !== error.status) {
    return Object.assign(error, { defined: false });
  }

  if (entry.data) {
    try {
      const validatedData = await validateSchema(entry.data, error.data);
      return Object.assign(error, { data: validatedData, defined: true });
    } catch {
      return Object.assign(error, { defined: false });
    }
  }

  return Object.assign(error, { defined: true });
}
