/**
 * Router types and utilities.
 *
 * A router is a nested map of procedures (or lazy-loaded procedures).
 */

import type { AnyProcedure, Procedure } from "./procedure.ts";
import type { Lazyable } from "./lazy.ts";
import type { AnyContractRouter } from "../contract/router.ts";
import type { AnyContractProcedure, ContractProcedure } from "../contract/procedure.ts";
import type { Context } from "../core/types.ts";
import { isProcedure } from "./procedure.ts";
import { isLazy, unlazy } from "./lazy.ts";
import { isContractProcedure } from "../contract/procedure.ts";

/** A server router — maps contract procedures to implementations */
export type Router<T extends AnyContractRouter, TInitialContext extends Context> =
  T extends ContractProcedure<infer TIn, infer TOut, infer TErr, infer TMeta>
    ? Procedure<TInitialContext, any, TIn, TOut, TErr, TMeta>
    : T extends Record<string, AnyContractRouter>
      ? { [K in keyof T]: Lazyable<Router<T[K], TInitialContext>> }
      : never;

export type AnyRouter = AnyProcedure | { [key: string]: Lazyable<AnyRouter> };

/** Get a router client type from a router */
export type RouterClient<T extends AnyRouter, TClientContext = Record<never, never>> =
  T extends Procedure<any, any, infer TIn, infer TOut, any, any>
    ? (input: TIn extends undefined ? void : TIn, options?: { signal?: AbortSignal; context?: TClientContext }) => Promise<TOut>
    : T extends Record<string, Lazyable<AnyRouter>>
      ? { [K in keyof T]: RouterClient<(T[K] extends Lazyable<infer R> ? R : never) & AnyRouter, TClientContext> }
      : never;

/** Infer the initial context type from a router */
export type InferRouterInitialContext<T extends AnyRouter> =
  T extends Procedure<infer TCtx, any, any, any, any, any> ? TCtx : never;

/**
 * Traverse all procedures in a router, resolving lazy boundaries.
 */
export async function traverseProcedures(
  router: AnyRouter,
  callback: (path: string[], procedure: AnyProcedure) => void,
  path: string[] = [],
): Promise<void> {
  if (isProcedure(router)) {
    callback(path, router);
    return;
  }

  for (const [key, child] of Object.entries(router as Record<string, Lazyable<AnyRouter>>)) {
    const resolved = isLazy(child) ? (await unlazy(child)).default : child;
    await traverseProcedures(resolved, callback, [...path, key]);
  }
}

/**
 * Create a direct in-process client for a router.
 * Used for server-side calling without HTTP.
 */
export function createRouterClient<T extends AnyRouter>(
  router: T,
  options: {
    context: Context;
    path?: readonly string[];
  },
): RouterClient<T> {
  const { context, path = [] } = options;

  return new Proxy((() => {}) as unknown as RouterClient<T>, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (typeof prop !== "string") return undefined;
      const child = (router as Record<string, unknown>)[prop];
      if (!child) return undefined;
      return createRouterClient(child as AnyRouter, {
        context,
        path: [...path, prop],
      });
    },
    apply(_target, _thisArg, args) {
      if (!isProcedure(router)) {
        throw new Error(`Cannot call non-procedure at path: ${path.join(".")}`);
      }
      const [input, callOptions] = args;
      const procedure = router;
      const def = procedure["~katman"];

      // Import compilePipeline dynamically to avoid circular deps
      // (In real impl, the pipeline is pre-compiled and cached)
      return executeProcedure(def, context, input, callOptions?.signal);
    },
  });
}

async function executeProcedure(
  def: AnyProcedure["~katman"],
  context: Context,
  input: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const { compilePipeline } = await import("../core/pipeline.ts");
  const { validateSchema } = await import("../core/schema.ts");
  const { createErrorConstructorMap } = await import("./error.ts");

  const inputValidate = def.inputSchema
    ? (val: unknown) => validateSchema(def.inputSchema!, val)
    : undefined;
  const outputValidate = def.outputSchema
    ? (val: unknown) => validateSchema(def.outputSchema!, val)
    : undefined;

  const pipeline = compilePipeline(
    def.middlewares,
    def.handler,
    inputValidate,
    outputValidate,
    {
      inputValidationIndex: def.inputValidationIndex,
      outputValidationIndex: def.outputValidationIndex,
    },
  );

  const errors = createErrorConstructorMap(def.errorMap);
  return pipeline(
    context,
    input,
    signal ?? AbortSignal.timeout(30_000),
    [],
    def.meta,
    errors,
  );
}
