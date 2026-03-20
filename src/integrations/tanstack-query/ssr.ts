/**
 * SSR Hydration for TanStack Query — prevent refetch waterfalls.
 *
 * Prefetch queries on the server and dehydrate them for the client.
 * The client hydrates without refetching — zero waterfall.
 *
 * @example
 * ```ts
 * // Server (SSR)
 * import { prefetchQueries, dehydrate } from "silgi/tanstack-query/ssr"
 *
 * const queryClient = new QueryClient()
 * await prefetchQueries(queryClient, utils, [
 *   utils.users.list.queryOptions({ input: { limit: 10 } }),
 *   utils.health.queryOptions({ input: undefined }),
 * ])
 * const dehydratedState = dehydrate(queryClient)
 *
 * // Client
 * <HydrationBoundary state={dehydratedState}>
 *   <App />
 * </HydrationBoundary>
 * ```
 */

/**
 * Prefetch multiple queries on the server.
 * Pass the same options you'd use with `useQuery`.
 */
export async function prefetchQueries(
  queryClient: any,
  ...optionsArray: Array<{ queryKey: unknown; queryFn: Function } | Array<{ queryKey: unknown; queryFn: Function }>>
): Promise<void> {
  const flat = optionsArray.flat()
  await Promise.all(flat.map((opts) => queryClient.prefetchQuery(opts)))
}

/**
 * Dehydrate the query client for SSR transfer.
 * Wraps TanStack Query's dehydrate with Silgi-aware serialization.
 */
export function dehydrate(queryClient: any): unknown {
  // Use TanStack Query's built-in dehydrate
  if (typeof queryClient.dehydrate === 'function') {
    return queryClient.dehydrate()
  }
  // Fallback: manual cache extraction
  const cache = queryClient.getQueryCache?.()
  if (!cache) return {}

  const queries = cache.getAll().map((query: any) => ({
    queryKey: query.queryKey,
    state: query.state,
  }))

  return { queries }
}

/**
 * Create a custom serializer for SSR hydration that handles
 * Silgi-specific types (Date, Map, etc.) during dehydration.
 */
export function createSSRSerializer() {
  return {
    serialize: (value: unknown): string => {
      return JSON.stringify(value, function (_key, val) {
        // JSON.stringify calls .toJSON() on Date before replacer, so check the original
        const original = this[_key]
        if (original instanceof Date) return { __type: 'Date', value: original.toISOString() }
        if (original instanceof Map) return { __type: 'Map', value: Array.from(original.entries()) }
        if (original instanceof Set) return { __type: 'Set', value: Array.from(original) }
        if (typeof original === 'bigint') return { __type: 'BigInt', value: original.toString() }
        return val
      })
    },
    deserialize: (text: string): unknown => {
      return JSON.parse(text, (_key, val) => {
        if (val && typeof val === 'object' && '__type' in val) {
          switch (val.__type) {
            case 'Date':
              return new Date(val.value)
            case 'Map':
              return new Map(val.value)
            case 'Set':
              return new Set(val.value)
            case 'BigInt':
              return BigInt(val.value)
          }
        }
        return val
      })
    },
  }
}
