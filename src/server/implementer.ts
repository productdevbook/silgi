/**
 * Contract-first implementation — the `implement(contract)` pattern.
 *
 * Takes a contract and returns a builder that constrains server
 * implementations to match the contract's schemas, errors, and routes.
 *
 * Usage:
 *   const contract = { users: { list: kc.input(schema).output(schema) } }
 *   const server = implement(contract)
 *   const router = server.router({
 *     users: {
 *       list: server.users.list.handler(async ({ input }) => { ... })
 *     }
 *   })
 */

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from "../core/schema.ts";
import type { Context, Promisable } from "../core/types.ts";
import type { AnyMiddleware, Handler, Middleware, MiddlewareResult } from "../core/pipeline.ts";
import type { ErrorMap } from "../contract/error.ts";
import type { Meta } from "../contract/meta.ts";
import type { AnyContractProcedure } from "../contract/procedure.ts";
import type { AnyContractRouter } from "../contract/router.ts";
import type { ErrorConstructorMap } from "./error.ts";
import { Procedure } from "./procedure.ts";
import { isContractProcedure } from "../contract/procedure.ts";
import { mergeMiddlewares } from "../core/pipeline.ts";
import { mergeErrorMap } from "../contract/error.ts";

/**
 * Create an implementer from a contract.
 */
export function implement<
  TContract extends AnyContractRouter,
  TContext extends Context = Record<never, never>,
>(
  contract: TContract,
  config?: { dedupeLeadingMiddlewares?: boolean },
): Implementer<TContract, TContext> {
  return createImplementer(contract, {
    middlewares: [],
    dedupeLeading: config?.dedupeLeadingMiddlewares ?? true,
  });
}

export interface Implementer<
  TContract extends AnyContractRouter,
  TContext extends Context,
> {
  /** Add middleware to all procedures */
  use<UOutContext extends Context>(
    middleware: Middleware<TContext, UOutContext, unknown, unknown, any>,
  ): Implementer<TContract, TContext & UOutContext>;

  /** Provide a router implementation */
  router<T extends ImplementedRouter<TContract, TContext>>(router: T): T;
}

/** A router that matches the contract shape but has Procedure implementations */
type ImplementedRouter<TContract extends AnyContractRouter, TContext extends Context> =
  TContract extends AnyContractProcedure
    ? Procedure<TContext, any, any, any, any, any>
    : TContract extends Record<string, AnyContractRouter>
      ? { [K in keyof TContract]: ImplementedRouter<TContract[K], TContext> }
      : never;

function createImplementer<TContract extends AnyContractRouter, TContext extends Context>(
  contract: TContract,
  state: {
    middlewares: readonly AnyMiddleware[];
    dedupeLeading: boolean;
  },
): Implementer<TContract, TContext> {
  // Build the procedure implementer proxies for dot-access
  const procedureProxy = createContractProxy(contract, state);

  return {
    use(middleware: AnyMiddleware) {
      return createImplementer(contract, {
        ...state,
        middlewares: [...state.middlewares, middleware],
      }) as any;
    },

    router(router: any) {
      return enhanceImplementedRouter(router, contract, state) as any;
    },

    // Allow dot-access to contract procedures for building handlers
    ...procedureProxy,
  } as any;
}

/**
 * Create a Proxy that mirrors the contract structure.
 * Accessing `impl.users.list` returns a ProcedureImplementer for that contract procedure.
 */
function createContractProxy(
  contract: AnyContractRouter,
  state: { middlewares: readonly AnyMiddleware[]; dedupeLeading: boolean },
): Record<string, unknown> {
  if (isContractProcedure(contract)) {
    return createProcedureImplementer(contract, state);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(contract as Record<string, AnyContractRouter>)) {
    result[key] = createContractProxy(child, state);
  }
  return result;
}

/**
 * A procedure implementer — provides a `.handler()` method that creates
 * a Procedure matching the contract's schemas.
 */
function createProcedureImplementer(
  contractProcedure: AnyContractProcedure,
  state: { middlewares: readonly AnyMiddleware[]; dedupeLeading: boolean },
): Record<string, unknown> {
  const def = contractProcedure["~katman"];
  let localMiddlewares: AnyMiddleware[] = [];

  const self = {
    use(middleware: AnyMiddleware) {
      localMiddlewares = [...localMiddlewares, middleware];
      return self;
    },

    handler(fn: Handler) {
      const allMiddlewares = mergeMiddlewares(
        state.middlewares,
        localMiddlewares,
        state.dedupeLeading,
      );

      return new Procedure({
        inputSchema: def.inputSchema,
        outputSchema: def.outputSchema,
        errorMap: def.errorMap,
        route: def.route,
        meta: def.meta,
        middlewares: allMiddlewares,
        handler: fn,
        inputValidationIndex: allMiddlewares.length,
        outputValidationIndex: allMiddlewares.length,
      });
    },
  };

  return self;
}

/**
 * Enhance an implemented router by prepending shared middlewares
 * and merging error maps from the implementer state.
 */
function enhanceImplementedRouter(
  router: unknown,
  contract: AnyContractRouter,
  state: { middlewares: readonly AnyMiddleware[]; dedupeLeading: boolean },
): unknown {
  if (router instanceof Procedure) {
    const def = router["~katman"];
    const merged = mergeMiddlewares(state.middlewares, def.middlewares, state.dedupeLeading);
    const added = merged.length - def.middlewares.length;

    return new Procedure({
      ...def,
      middlewares: merged,
      inputValidationIndex: def.inputValidationIndex + added,
      outputValidationIndex: def.outputValidationIndex + added,
    });
  }

  if (typeof router === "object" && router !== null) {
    const result: Record<string, unknown> = {};
    const contractRecord = contract as Record<string, AnyContractRouter>;
    for (const [key, child] of Object.entries(router as Record<string, unknown>)) {
      result[key] = enhanceImplementedRouter(child, contractRecord[key]!, state);
    }
    return result;
  }

  return router;
}
