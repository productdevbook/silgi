/**
 * Framework-internal symbol keys for the shared pipeline context.
 *
 * @internal
 *
 * @remarks
 * These keys are reserved by Silgi internals and MUST NOT be used as
 * ordinary fields in user context objects. Centralizing them in one
 * module makes the reserved surface trivial to audit — there is nowhere
 * else in the codebase where silgi stamps a symbol key onto `ctx`.
 */

/**
 * Pipeline raw-input slot. The wrap onion reads the input off this slot
 * so middleware (e.g. `mapInput`) can rewrite it before the resolver runs.
 *
 * @internal
 */
export const RAW_INPUT = Symbol.for('silgi.rawInput')
