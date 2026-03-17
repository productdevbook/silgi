/**
 * React integration — Server Actions and hooks.
 *
 * Provides:
 * - createActionableClient: wraps a procedure for React Server Actions
 * - createFormAction: converts a procedure into a FormData-accepting action
 * - useServerAction: React hook for calling server actions with state management
 */

import type { AnyProcedure } from "../../server/procedure.ts";
import type { Context } from "../../core/types.ts";
import { compilePipeline } from "../../core/pipeline.ts";
import { validateSchema } from "../../core/schema.ts";
import { createErrorConstructorMap } from "../../server/error.ts";
import { KatmanError, toKatmanError } from "../../core/error.ts";

// === Actionable Client ===

export type ActionableResult<TOutput, TError> =
  | [error: null, data: TOutput]
  | [error: TError, data: undefined];

/**
 * Create a server action from a procedure.
 * Returns [error, data] tuples instead of throwing.
 *
 * Special cases: Next.js redirect/notFound errors are rethrown.
 */
export function createActionableClient<TInput, TOutput>(
  procedure: AnyProcedure,
  options?: { context?: Context },
): (input: TInput) => Promise<ActionableResult<TOutput, unknown>> {
  const def = procedure["~katman"];
  const ctx = options?.context ?? {};

  const inputValidate = def.inputSchema
    ? (v: unknown) => validateSchema(def.inputSchema!, v)
    : undefined;
  const outputValidate = def.outputSchema
    ? (v: unknown) => validateSchema(def.outputSchema!, v)
    : undefined;

  const pipeline = compilePipeline(
    def.middlewares,
    def.handler,
    inputValidate,
    outputValidate,
    { inputValidationIndex: def.inputValidationIndex, outputValidationIndex: def.outputValidationIndex },
  );

  return async (input: TInput): Promise<ActionableResult<TOutput, unknown>> => {
    try {
      const errors = createErrorConstructorMap(def.errorMap);
      const output = await pipeline(
        ctx,
        input,
        AbortSignal.timeout(30_000),
        [],
        def.meta,
        errors,
      );
      return [null, output as TOutput];
    } catch (error) {
      // Rethrow Next.js special errors
      if (isNextJsError(error)) throw error;
      // Rethrow TanStack Router errors
      if (isTanStackRouterError(error)) throw error;

      const katmanError = toKatmanError(error);
      return [katmanError.toJSON() as unknown, undefined];
    }
  };
}

// === Form Action ===

/**
 * Create a FormData-accepting action from a procedure.
 * Parses form data using bracket notation (user[name] → { user: { name: value } }).
 */
export function createFormAction<TOutput>(
  procedure: AnyProcedure,
  options?: {
    context?: Context;
    /** Custom form data parser */
    parseFormData?: (formData: FormData) => unknown;
  },
): (formData: FormData) => Promise<ActionableResult<TOutput, unknown>> {
  const actionable = createActionableClient<unknown, TOutput>(procedure, options);
  const parser = options?.parseFormData ?? defaultFormDataParser;

  return async (formData: FormData) => {
    const input = parser(formData);
    return actionable(input);
  };
}

/**
 * Default form data parser — supports bracket notation.
 * user[name] → { user: { name: value } }
 * items[0] → { items: [value] }
 */
function defaultFormDataParser(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of formData.entries()) {
    const actualValue = value instanceof File && value.size === 0 ? undefined : value;
    setBracketNotation(result, key, actualValue);
  }

  return result;
}

function setBracketNotation(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = parseBracketPath(path);
  let current: any = obj;

  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i]!;
    const nextKey = keys[i + 1];
    if (!(key in current)) {
      current[key] = typeof nextKey === "number" ? [] : {};
    }
    current = current[key];
  }

  const lastKey = keys[keys.length - 1]!;
  current[lastKey] = value;
}

function parseBracketPath(path: string): (string | number)[] {
  const result: (string | number)[] = [];
  const parts = path.split("[");

  result.push(parts[0]!);
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!.replace("]", "");
    const num = parseInt(part, 10);
    result.push(isNaN(num) ? part : num);
  }

  return result;
}

// === Next.js / TanStack Router Error Detection ===

function isNextJsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const digest = (error as any).digest;
  return typeof digest === "string" && digest.startsWith("NEXT_");
}

function isTanStackRouterError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return (error as any).isNotFound === true || error instanceof Response;
}
