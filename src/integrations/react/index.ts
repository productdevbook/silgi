/**
 * React Server Actions — v2 integration.
 *
 * Creates type-safe server actions from v2 procedures.
 * Returns [error, data] tuples instead of throwing.
 */

import type { ProcedureDef, RouterDef } from "../../types.ts";
import { compileProcedure, type CompiledHandler } from "../../compile.ts";
import { KatmanError, toKatmanError } from "../../core/error.ts";

export type ActionResult<TOutput> =
  | [error: null, data: TOutput]
  | [error: { code: string; status: number; message: string; data?: unknown }, data: undefined];

/**
 * Create a server action from a v2 ProcedureDef.
 *
 * @example
 * ```ts
 * // app/actions.ts
 * "use server"
 * import { createAction } from "katman/react"
 *
 * export const createUser = createAction(appRouter.users.create)
 *
 * // app/page.tsx
 * const [error, user] = await createUser({ name: "Alice" })
 * ```
 */
export function createAction<TInput = unknown, TOutput = unknown>(
  procedure: ProcedureDef,
): (input: TInput) => Promise<ActionResult<TOutput>> {
  const handler = compileProcedure(procedure);
  const signal = new AbortController().signal;

  return async (input: TInput): Promise<ActionResult<TOutput>> => {
    try {
      const ctx: Record<string, unknown> = Object.create(null);
      const result = handler(ctx, input, signal);
      const output = result instanceof Promise ? await result : result;
      return [null, output as TOutput];
    } catch (error) {
      if (isFrameworkError(error)) throw error;
      const e = error instanceof KatmanError ? error : toKatmanError(error);
      return [e.toJSON() as any, undefined];
    }
  };
}

/**
 * Create a FormData-accepting server action from a v2 procedure.
 */
export function createFormAction<TOutput = unknown>(
  procedure: ProcedureDef,
  options?: { parseFormData?: (fd: FormData) => unknown },
): (formData: FormData) => Promise<ActionResult<TOutput>> {
  const action = createAction<unknown, TOutput>(procedure);
  const parse = options?.parseFormData ?? defaultFormDataParser;
  return (formData: FormData) => action(parse(formData));
}

/**
 * Create actions for all procedures in a router.
 *
 * @example
 * ```ts
 * const actions = createActions(appRouter)
 * const [error, users] = await actions.users.list({ limit: 10 })
 * ```
 */
export function createActions<T extends RouterDef>(router: T): ActionRouter<T> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(router)) {
    if (isProcedureDef(value)) {
      result[key] = createAction(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = createActions(value as RouterDef);
    }
  }
  return result as ActionRouter<T>;
}

// ── Types ──────────────────────────────────────────

type ActionRouter<T extends RouterDef> = {
  [K in keyof T]: T[K] extends ProcedureDef<any, infer TInput, infer TOutput>
    ? (input: TInput extends undefined ? void : TInput) => Promise<ActionResult<TOutput>>
    : T[K] extends RouterDef
      ? ActionRouter<T[K]>
      : never;
};

// ── Helpers ────────────────────────────────────────

function isProcedureDef(v: unknown): v is ProcedureDef {
  return typeof v === "object" && v !== null && "type" in v && "resolve" in v;
}

function isFrameworkError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  // Next.js
  if (typeof (error as any).digest === "string" && (error as any).digest.startsWith("NEXT_")) return true;
  // TanStack Router
  if ((error as any).isNotFound === true) return true;
  // Response (redirect)
  if (error instanceof Response) return true;
  return false;
}

function defaultFormDataParser(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    const v = value instanceof File && value.size === 0 ? undefined : value;
    setNestedValue(result, key, v);
  }
  return result;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split("[").map((k) => k.replace("]", ""));
  let current: any = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i]!;
    const next = keys[i + 1]!;
    if (!(k in current)) current[k] = /^\d+$/.test(next) ? [] : {};
    current = current[k];
  }
  current[keys[keys.length - 1]!] = value;
}
