/**
 * TanStack Query integration — generates type-safe query/mutation options
 * from a Katman client.
 *
 * Works with: @tanstack/react-query, @tanstack/vue-query,
 * @tanstack/solid-query, @tanstack/svelte-query
 *
 * Usage:
 *   const queryUtils = createQueryUtils(client)
 *   const options = queryUtils.users.list.queryOptions({ input: { limit: 10 } })
 *   // use with useQuery(options) or queryClient.fetchQuery(options)
 */

import type { ClientContext, NestedClient, Client } from "../../client/types.ts";

// === Key Generation ===

export type OperationType = "query" | "infinite" | "mutation";
export type OperationKey = [path: readonly string[], options: { type?: OperationType; input?: unknown }];

export function generateKey(
  path: readonly string[],
  options?: { type?: OperationType; input?: unknown },
): OperationKey {
  const keyOptions: Record<string, unknown> = {};
  if (options?.type) keyOptions.type = options.type;
  if (options?.input !== undefined) keyOptions.input = options.input;
  return [path, keyOptions];
}

// === Procedure Utils ===

export interface QueryOptionsIn<TInput, TOutput, TError> {
  input: TInput;
  queryKey?: unknown[];
  enabled?: boolean;
  staleTime?: number;
  gcTime?: number;
  refetchInterval?: number | false;
  retry?: boolean | number;
  select?: (data: TOutput) => unknown;
}

export interface MutationOptionsIn<TInput, TOutput, TError> {
  onSuccess?: (data: TOutput, input: TInput) => void;
  onError?: (error: TError, input: TInput) => void;
  onSettled?: (data: TOutput | undefined, error: TError | null, input: TInput) => void;
  retry?: boolean | number;
}

export interface ProcedureQueryUtils<TInput, TOutput, TError> {
  /** Direct call to the procedure */
  call: (input: TInput, options?: { signal?: AbortSignal }) => Promise<TOutput>;

  /** Generate a query key for this procedure */
  queryKey: (input?: TInput) => OperationKey;

  /** Generate full query options for useQuery */
  queryOptions: (options: QueryOptionsIn<TInput, TOutput, TError>) => {
    queryKey: OperationKey;
    queryFn: (ctx: { signal: AbortSignal }) => Promise<TOutput>;
    enabled?: boolean;
    staleTime?: number;
    gcTime?: number;
    refetchInterval?: number | false;
    retry?: boolean | number;
    select?: (data: TOutput) => unknown;
  };

  /** Generate a mutation key */
  mutationKey: () => OperationKey;

  /** Generate full mutation options for useMutation */
  mutationOptions: (options?: MutationOptionsIn<TInput, TOutput, TError>) => {
    mutationKey: OperationKey;
    mutationFn: (input: TInput) => Promise<TOutput>;
    onSuccess?: (data: TOutput, input: TInput) => void;
    onError?: (error: TError, input: TInput) => void;
    onSettled?: (data: TOutput | undefined, error: TError | null, input: TInput) => void;
    retry?: boolean | number;
  };
}

function createProcedureUtils<TInput, TOutput, TError>(
  client: Client<any, TInput, TOutput, TError>,
  path: readonly string[],
): ProcedureQueryUtils<TInput, TOutput, TError> {
  return {
    call: (input: TInput, options?: { signal?: AbortSignal }) =>
      client(input, options as any) as Promise<TOutput>,

    queryKey: (input?: TInput) =>
      generateKey(path, { type: "query", input }),

    queryOptions: (options) => ({
      queryKey: options.queryKey
        ? (options.queryKey as OperationKey)
        : generateKey(path, { type: "query", input: options.input }),
      queryFn: ({ signal }) => client(options.input, { signal } as any) as Promise<TOutput>,
      ...(options.enabled !== undefined && { enabled: options.enabled }),
      ...(options.staleTime !== undefined && { staleTime: options.staleTime }),
      ...(options.gcTime !== undefined && { gcTime: options.gcTime }),
      ...(options.refetchInterval !== undefined && { refetchInterval: options.refetchInterval }),
      ...(options.retry !== undefined && { retry: options.retry }),
      ...(options.select !== undefined && { select: options.select }),
    }),

    mutationKey: () => generateKey(path, { type: "mutation" }),

    mutationOptions: (options) => ({
      mutationKey: generateKey(path, { type: "mutation" }),
      mutationFn: (input: TInput) => client(input) as Promise<TOutput>,
      ...options,
    }),
  };
}

// === Router Utils (Recursive Proxy) ===

export interface GeneralUtils {
  /** Generate a key prefix for bulk invalidation */
  key: (input?: unknown) => OperationKey;
}

export type QueryUtils<T extends NestedClient> =
  T extends Client<any, infer TInput, infer TOutput, infer TError>
    ? ProcedureQueryUtils<TInput, TOutput, TError> & GeneralUtils
    : T extends Record<string, NestedClient>
      ? { [K in keyof T]: QueryUtils<T[K]> } & GeneralUtils
      : GeneralUtils;

/**
 * Create TanStack Query utilities from a Katman client.
 *
 * Returns a recursive proxy that mirrors the client structure,
 * with `.queryOptions()`, `.mutationOptions()`, `.queryKey()` at each level.
 */
export function createQueryUtils<T extends NestedClient>(
  client: T,
  path: readonly string[] = [],
): QueryUtils<T> {
  const generalUtils: GeneralUtils = {
    key: (input?: unknown) => generateKey(path, input !== undefined ? { input } : undefined),
  };

  // Check if this is a callable (procedure-level client)
  const procedureUtils = typeof client === "function"
    ? createProcedureUtils(client as any, path)
    : {};

  return new Proxy({} as QueryUtils<T>, {
    get(_target, prop) {
      if (prop === "then") return undefined;

      // General utils
      if (prop === "key") return generalUtils.key;

      // Procedure utils
      if (typeof prop === "string" && prop in procedureUtils) {
        return (procedureUtils as any)[prop];
      }

      // Recurse into child
      if (typeof prop === "string") {
        const child = (client as any)[prop];
        if (child) {
          return createQueryUtils(child, [...path, prop]);
        }
      }

      return undefined;
    },
  });
}
