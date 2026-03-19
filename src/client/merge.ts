/**
 * Client merging — combine multiple typed clients into one.
 *
 * Useful when different parts of your API live on different servers
 * or use different transports.
 *
 * @example
 * ```ts
 * import { mergeClients } from "katman/client"
 *
 * const client = mergeClients({
 *   users: usersClient,
 *   billing: billingClient,
 *   analytics: analyticsClient,
 * })
 *
 * await client.users.list({ limit: 10 })
 * await client.billing.invoices()
 * ```
 */

/**
 * Merge multiple clients into a single typed object.
 * Each key maps to a separate client — they can use different links.
 */
export function mergeClients<T extends Record<string, unknown>>(clients: T): T {
  return clients
}
