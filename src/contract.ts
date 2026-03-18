/**
 * Contract-first workflow — define API shape, then implement.
 *
 * Useful in monorepos where frontend and backend are separate packages.
 * The contract is shared, implementation is enforced by types.
 *
 * @example
 * ```ts
 * // packages/api-contract/index.ts (shared)
 * import { contract } from "katman/contract"
 * import { z } from "zod"
 *
 * export const api = contract({
 *   users: {
 *     list: {
 *       type: "query",
 *       input: z.object({ limit: z.number().optional() }),
 *       output: z.array(UserSchema),
 *     },
 *     create: {
 *       type: "mutation",
 *       input: z.object({ name: z.string() }),
 *       output: UserSchema,
 *       errors: { CONFLICT: 409 },
 *     },
 *   },
 * })
 *
 * // packages/api-server/index.ts (backend)
 * import { implement } from "katman/contract"
 * import { api } from "api-contract"
 *
 * const router = implement(api, (k) => ({
 *   users: {
 *     list: k.query(({ input, ctx }) => ctx.db.users.find({ take: input.limit })),
 *     create: k.mutation(({ input, ctx, fail }) => {
 *       if (exists(input.name)) fail("CONFLICT")
 *       return ctx.db.users.create(input)
 *     }),
 *   },
 * }))
 *
 * // packages/frontend/index.ts (client — no server import!)
 * import type { api } from "api-contract"
 * import type { InferContractClient } from "katman/contract"
 *
 * type Client = InferContractClient<typeof api>
 * // Client.users.list: (input: { limit?: number }) => Promise<User[]>
 * // Client.users.create: (input: { name: string }) => Promise<User>
 * ```
 */

import type { AnySchema, InferSchemaInput, InferSchemaOutput } from "./core/schema.ts";
import type { ProcedureType, ErrorDef, Route } from "./types.ts";

// ── Contract Definition Types ───────────────────────

export interface ProcedureContract<
  TType extends ProcedureType = ProcedureType,
  TInput extends AnySchema | undefined = AnySchema | undefined,
  TOutput extends AnySchema | undefined = AnySchema | undefined,
  TErrors extends ErrorDef = ErrorDef,
> {
  type?: TType;
  input?: TInput;
  output?: TOutput;
  errors?: TErrors;
  route?: Route;
  description?: string;
}

export type ContractRouter = {
  [key: string]: ProcedureContract<any, any, any, any> | ContractRouter;
};

// ── Contract Factory ────────────────────────────────

/**
 * Define an API contract — shared between client and server.
 * Pure type information, no runtime behavior.
 */
export function contract<T extends ContractRouter>(definition: T): T {
  return definition;
}

// ── Implementation Types ────────────────────────────

type ImplementProcedure<T extends ProcedureContract> =
  T extends ProcedureContract<infer _TType, infer TInput, infer TOutput, infer TErrors>
    ? (opts: {
        input: TInput extends AnySchema ? InferSchemaOutput<TInput> : undefined;
        ctx: Record<string, unknown>;
        fail: TErrors extends ErrorDef ? <K extends keyof TErrors & string>(code: K, ...args: any[]) => never : never;
        signal: AbortSignal;
      }) => TOutput extends AnySchema ? InferSchemaOutput<TOutput> | Promise<InferSchemaOutput<TOutput>> : unknown
    : never;

type ImplementRouter<T extends ContractRouter> = {
  [K in keyof T]: T[K] extends ProcedureContract
    ? ImplementProcedure<T[K]>
    : T[K] extends ContractRouter
      ? ImplementRouter<T[K]>
      : never;
};

// ── Implement Function ──────────────────────────────

/**
 * Implement a contract — returns a katman RouterDef.
 * Type-safe: implementation must match the contract.
 */
export function implement<T extends ContractRouter>(
  contractDef: T,
  implementations: ImplementRouter<T>,
): import("./types.ts").RouterDef {
  return buildRouter(contractDef, implementations);
}

function buildRouter(contractDef: ContractRouter, impls: any): any {
  const router: Record<string, unknown> = {};

  for (const [key, contractEntry] of Object.entries(contractDef)) {
    const impl = impls[key];
    if (!impl) continue;

    if (isProcedureContract(contractEntry)) {
      // Build a ProcedureDef from contract + implementation
      router[key] = {
        type: contractEntry.type ?? "query",
        input: contractEntry.input ?? null,
        output: contractEntry.output ?? null,
        errors: contractEntry.errors ?? null,
        use: null,
        resolve: impl,
        route: contractEntry.route ?? null,
      };
    } else {
      // Nested router
      router[key] = buildRouter(contractEntry as ContractRouter, impl);
    }
  }

  return router;
}

function isProcedureContract(v: unknown): v is ProcedureContract {
  if (typeof v !== "object" || v === null) return false;
  // A procedure contract has input/output/type but no "resolve"
  return "input" in v || "output" in v || "type" in v || "errors" in v;
}

// ── Client Type Inference from Contract ─────────────

/** Infer client type from a contract (no server code needed) */
export type InferContractClient<T extends ContractRouter> = {
  [K in keyof T]: T[K] extends ProcedureContract<any, infer TInput, infer TOutput>
    ? TInput extends AnySchema
      ? (input: InferSchemaInput<TInput>) => Promise<TOutput extends AnySchema ? InferSchemaOutput<TOutput> : unknown>
      : () => Promise<TOutput extends AnySchema ? InferSchemaOutput<TOutput> : unknown>
    : T[K] extends ContractRouter
      ? InferContractClient<T[K]>
      : never;
};
