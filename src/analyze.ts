/**
 * Static handler analysis — inspired by Elysia's Sucrose.
 *
 * Analyzes resolve function source code via Function.toString()
 * to determine which parts of the request are actually used.
 * Skips unnecessary work (body parsing, context creation, etc.)
 * when the handler doesn't need them.
 *
 * This is a compile-time optimization — runs once per procedure,
 * zero per-request cost.
 */

export interface HandlerAnalysis {
  /** Handler uses ctx (context) */
  usesContext: boolean;
  /** Handler uses input */
  usesInput: boolean;
  /** Handler uses fail (error throwing) */
  usesFail: boolean;
  /** Handler uses signal (abort) */
  usesSignal: boolean;
  /** Handler is async */
  isAsync: boolean;
}

/**
 * Analyze a resolve function to determine what it actually uses.
 *
 * @example
 * ```ts
 * analyzeHandler(({ ctx }) => ctx.db.users.findMany())
 * // → { usesContext: true, usesInput: false, usesFail: false, usesSignal: false, isAsync: false }
 *
 * analyzeHandler(async ({ input }) => input.name)
 * // → { usesContext: false, usesInput: true, usesFail: false, usesSignal: false, isAsync: true }
 * ```
 */
export function analyzeHandler(fn: Function): HandlerAnalysis {
  const src = fn.toString();

  // Detect destructuring pattern: ({ ctx, input, fail, signal })
  // Also handles renamed destructuring: ({ ctx: context, input: data })
  // And property access: opts.ctx, opts.input, etc.

  const isAsync = src.startsWith("async ") || src.includes("__async");

  // Check for destructured parameter names or property access
  const usesContext = /\bctx\b/.test(src) || /\.ctx\b/.test(src) || /\bcontext\b/.test(src);
  const usesInput = /\binput\b/.test(src) || /\.input\b/.test(src);
  const usesFail = /\bfail\b/.test(src) || /\.fail\b/.test(src);
  const usesSignal = /\bsignal\b/.test(src) || /\.signal\b/.test(src);

  return { usesContext, usesInput, usesFail, usesSignal, isAsync };
}

/**
 * Generate optimization hints from handler analysis.
 * Used by the compiler to skip unnecessary work.
 */
export interface OptimizationHints {
  /** Skip body parsing entirely (handler doesn't use input) */
  skipBodyParse: boolean;
  /** Skip context factory call (handler doesn't use context) */
  skipContext: boolean;
  /** Skip fail function creation (handler doesn't use fail) */
  skipFail: boolean;
  /** Handler is guaranteed sync (no async/await) */
  guaranteedSync: boolean;
}

export function getOptimizationHints(analysis: HandlerAnalysis, hasInput: boolean): OptimizationHints {
  return {
    skipBodyParse: !analysis.usesInput && !hasInput,
    skipContext: !analysis.usesContext,
    skipFail: !analysis.usesFail,
    guaranteedSync: !analysis.isAsync,
  };
}
