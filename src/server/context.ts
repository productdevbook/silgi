/**
 * Context type utilities for middleware chain type inference.
 */

import type { Context } from "../core/types.ts";

/**
 * Merge current context: new properties override old ones.
 * This is the type that flows forward through middlewares.
 */
export type MergedCurrentContext<T extends Context, U extends Context> = Omit<T, keyof U> & U;

/**
 * Merge initial context: the builder's initial context must include
 * whatever extra keys the middleware requires that aren't in current context.
 * This is what callers must provide at invocation time.
 */
export type MergedInitialContext<
  TInitial extends Context,
  TAdditional extends Context,
  TCurrent extends Context,
> = TInitial & Omit<TAdditional, keyof TCurrent>;
