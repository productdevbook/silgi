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

/**
 * Brand stamped on a `RouterDef` by `silgi({ wraps }).router(def)` to carry
 * the instance's root wraps along with the def itself.
 *
 * @remarks
 * Every compile site (`silgi.router`, `createCaller`, `createFetchHandler`,
 * WS hooks, adapter `createHandler` variants) calls `compileRouter(def)`.
 * Reading the brand off `def` inside `compileRouter` means root wraps
 * reach every adapter without any per-adapter plumbing, without relying
 * on `routerCache`, and without a second tree walk.
 *
 * The brand is a non-enumerable own property on the user's def (Symbol
 * keys are skipped by `Object.entries`, so router traversal is unaffected).
 *
 * @internal
 */
export const ROOT_WRAPS = Symbol.for('silgi.rootWraps')
