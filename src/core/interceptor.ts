/**
 * Interceptor pipeline — pre-linked execution chain.
 */

import type { Promisable } from "./types.ts";

export interface InterceptorOptions<TOutput> {
  next: () => Promise<TOutput>;
}

export type Interceptor<TOutput, TContext = unknown> = (
  options: InterceptorOptions<TOutput> & TContext,
) => Promisable<TOutput>;

/**
 * Execute through an interceptor chain, pre-linking from inside out.
 */
export function intercept<TOutput, TContext extends object>(
  interceptors: readonly Interceptor<TOutput, TContext>[],
  context: TContext,
  execute: (ctx: TContext) => Promisable<TOutput>,
): Promise<TOutput> {
  if (interceptors.length === 0) {
    return Promise.resolve(execute(context));
  }

  let fn = (ctx: TContext) => Promise.resolve(execute(ctx));

  for (let i = interceptors.length - 1; i >= 0; i--) {
    const interceptor = interceptors[i]!;
    const next = fn;
    fn = (ctx: TContext) =>
      Promise.resolve(interceptor({ ...ctx, next: () => next(ctx) }));
  }

  return fn(context);
}

export function onStart<TOutput, TContext = unknown>(
  callback: (ctx: TContext) => Promisable<void>,
): Interceptor<TOutput, TContext> {
  return async (opts) => {
    await callback(opts as unknown as TContext);
    return opts.next();
  };
}

export function onSuccess<TOutput, TContext = unknown>(
  callback: (output: TOutput, ctx: TContext) => Promisable<void>,
): Interceptor<TOutput, TContext> {
  return async (opts) => {
    const result = await opts.next();
    await callback(result, opts as unknown as TContext);
    return result;
  };
}

export function onError<TOutput, TContext = unknown>(
  callback: (error: unknown, ctx: TContext) => Promisable<void>,
): Interceptor<TOutput, TContext> {
  return async (opts) => {
    try {
      return await opts.next();
    } catch (error) {
      await callback(error, opts as unknown as TContext);
      throw error;
    }
  };
}

export function onFinish<TOutput, TContext = unknown>(
  callback: (
    result: [error: null, output: TOutput] | [error: unknown, output: undefined],
    ctx: TContext,
  ) => Promisable<void>,
): Interceptor<TOutput, TContext> {
  return async (opts) => {
    try {
      const output = await opts.next();
      await callback([null, output], opts as unknown as TContext);
      return output;
    } catch (error) {
      await callback([error, undefined], opts as unknown as TContext);
      throw error;
    }
  };
}
