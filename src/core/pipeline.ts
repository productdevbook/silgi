/**
 * Compiled Middleware Pipeline — Katman's signature innovation.
 *
 * oRPC: runtime recursive dispatch with index tracking
 *   next(index+1, context, input) → new closure per call
 *
 * Katman: pre-linked chain built at definition time
 *   each middleware's `next` is a direct function reference
 *   → zero runtime closure allocation for the chain structure
 *
 * Validation is baked into the chain at the correct position
 * rather than checked via index comparison at every step.
 */

import type { Promisable, Context } from "./types.ts";

export interface MiddlewareResult<TOutContext extends Context = Context> {
  output: unknown;
  context: TOutContext;
}

export interface MiddlewareOptions<
  TContext extends Context,
  TOutput,
  TMeta = unknown,
> {
  context: TContext;
  path: readonly string[];
  signal: AbortSignal;
  meta: TMeta;
  errors: unknown;
  next: (opts?: { context?: Context }) => Promise<MiddlewareResult>;
}

export type Middleware<
  TInContext extends Context = Context,
  TOutContext extends Context = Context,
  TInput = unknown,
  TOutput = unknown,
  TMeta = unknown,
> = (
  options: MiddlewareOptions<TInContext, TOutput, TMeta>,
  input: TInput,
) => Promisable<MiddlewareResult<TOutContext>>;

export type AnyMiddleware = Middleware<any, any, any, any, any>;

export type Handler<
  TContext extends Context = Context,
  TInput = unknown,
  TOutput = unknown,
  TMeta = unknown,
> = (options: {
  context: TContext;
  input: TInput;
  path: readonly string[];
  signal: AbortSignal;
  meta: TMeta;
  errors: unknown;
}) => Promisable<TOutput>;

export interface PipelineConfig {
  inputValidationIndex: number;
  outputValidationIndex: number;
}

export type CompiledPipeline = (
  context: Context,
  input: unknown,
  signal: AbortSignal,
  path: readonly string[],
  meta: unknown,
  errors: unknown,
) => Promise<unknown>;

/**
 * Compile a middleware chain + handler into a single pre-linked function.
 *
 * Built once at definition time. At request time: single function call,
 * no index tracking, no runtime closure creation for the chain structure.
 */
export function compilePipeline(
  middlewares: readonly AnyMiddleware[],
  handler: Handler,
  inputValidate: ((input: unknown) => Promisable<unknown>) | undefined,
  outputValidate: ((output: unknown) => Promisable<unknown>) | undefined,
  config: PipelineConfig,
): CompiledPipeline {
  type Step = (
    ctx: Context, input: unknown, signal: AbortSignal,
    path: readonly string[], meta: unknown, errors: unknown,
  ) => Promise<unknown>;

  // Build from inside out

  // Innermost: the handler
  let chain: Step = async (ctx, input, signal, path, meta, errors) =>
    handler({ context: ctx, input, signal, path, meta, errors });

  // Wrap middlewares from innermost to outermost
  for (let i = middlewares.length - 1; i >= 0; i--) {
    const mw = middlewares[i]!;
    const nextStep = chain;
    const validateInput = inputValidate && config.inputValidationIndex === i;
    const validateOutput = outputValidate && config.outputValidationIndex === i;

    chain = async (ctx, input, signal, path, meta, errors) => {
      let currentInput = validateInput ? await inputValidate!(input) : input;

      const result = await mw(
        {
          context: ctx,
          path,
          signal,
          meta,
          errors,
          next: async (opts) => {
            const mergedCtx = opts?.context ? { ...ctx, ...opts.context } : ctx;
            const output = await nextStep(mergedCtx, currentInput, signal, path, meta, errors);
            return { output, context: opts?.context ?? {} };
          },
        },
        currentInput,
      );

      return validateOutput ? outputValidate!(result.output) : result.output;
    };
  }

  // Handle edge case: validation at position 0 with no middlewares
  if (middlewares.length === 0 && inputValidate) {
    const inner = chain;
    chain = async (ctx, input, signal, path, meta, errors) => {
      const validated = await inputValidate(input);
      const output = await inner(ctx, validated, signal, path, meta, errors);
      return outputValidate ? outputValidate(output) : output;
    };
  } else if (middlewares.length === 0 && outputValidate) {
    const inner = chain;
    chain = async (ctx, input, signal, path, meta, errors) => {
      const output = await inner(ctx, input, signal, path, meta, errors);
      return outputValidate(output);
    };
  }

  return chain;
}

export function mergeMiddlewares(
  first: readonly AnyMiddleware[],
  second: readonly AnyMiddleware[],
  dedupeLeading = false,
): AnyMiddleware[] {
  if (dedupeLeading && startsWithMiddlewares(second, first)) {
    return [...second];
  }
  return [...first, ...second];
}

export function startsWithMiddlewares(
  haystack: readonly AnyMiddleware[],
  needle: readonly AnyMiddleware[],
): boolean {
  if (needle.length > haystack.length) return false;
  for (let i = 0; i < needle.length; i++) {
    if (haystack[i] !== needle[i]) return false;
  }
  return true;
}

export function mergeContext<T extends Context, U extends Context>(current: T, next: U): T & U {
  return { ...current, ...next } as T & U;
}
