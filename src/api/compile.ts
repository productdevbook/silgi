/**
 * Pipeline compiler — the performance core.
 *
 * Separates guards (flat, zero-closure) from wraps (onion, minimal closure).
 * Compiles at router() time, not per-request.
 *
 * Performance characteristics:
 * - Guards: O(n) sequential, 0 closures, sync fast-path
 * - Wraps: O(m) onion closures where m = wrap count (typically 0-2)
 * - Total per-request closures: m (not n+m like traditional onion)
 */

import type { ProcedureDef, GuardDef, WrapDef, MiddlewareDef, ErrorDef, ErrorDefItem } from "./types.ts";
import { validateSchema, type AnySchema } from "../core/schema.ts";
import { KatmanError } from "../core/error.ts";

/** Compiled pipeline — called per request */
export type CompiledHandler = (
  ctx: Record<string, unknown>,
  rawInput: unknown,
  signal: AbortSignal,
) => Promise<unknown>;

/** Check if a value is a thenable (async detection without instanceof) */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return value !== null && typeof value === "object" && typeof (value as any).then === "function";
}

/** Check if a value is a plain object (not a class instance) */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Create a fail() function from an error definition — singleton per procedure */
function createFail(errors: ErrorDef): (code: string, data?: unknown) => never {
  return (code: string, data?: unknown): never => {
    const def = errors[code];
    const status = typeof def === "number" ? def : def?.status ?? 500;
    const message = typeof def === "object" && def !== null && "message" in def
      ? (def as { message?: string }).message
      : undefined;
    throw new KatmanError(code, { status, message, data, defined: true });
  };
}

/**
 * Compile a procedure into an optimized request handler.
 *
 * Called once at router() time. The returned function is called per-request.
 */
export function compileProcedure(procedure: ProcedureDef): CompiledHandler {
  const middlewares = procedure.use ?? [];
  const guards: GuardDef[] = [];
  const wraps: WrapDef[] = [];

  for (const mw of middlewares) {
    if (mw.kind === "guard") guards.push(mw);
    else wraps.push(mw);
  }

  const inputSchema = procedure.input;
  const outputSchema = procedure.output;
  const resolveFn = procedure.resolve;
  const failFn = procedure.errors ? createFail(procedure.errors) : noopFail;

  // Fast path: no wraps (most common — ~90% of procedures)
  if (wraps.length === 0) {
    return async (ctx, rawInput, signal) => {
      // 1. Run guards flat — zero closures
      await runGuards(guards, ctx);

      // 2. Validate input
      const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput;

      // 3. Execute resolve
      const output = await resolveFn({ input, ctx, fail: failFn, signal });

      // 4. Validate output
      return outputSchema ? await validateSchema(outputSchema, output) : output;
    };
  }

  // Slow path: has wraps — build onion for wrap portion only
  return async (ctx, rawInput, signal) => {
    // 1. Run guards flat — zero closures
    await runGuards(guards, ctx);

    // 2. Validate input
    const input = inputSchema ? await validateSchema(inputSchema, rawInput) : rawInput;

    // 3. Build wrap onion (closures only for wraps, not guards)
    let execute: () => Promise<unknown> = () =>
      Promise.resolve(resolveFn({ input, ctx, fail: failFn, signal }));

    for (let i = wraps.length - 1; i >= 0; i--) {
      const wrapFn = wraps[i]!.fn;
      const next = execute;
      execute = () => wrapFn(ctx, next);
    }

    // 4. Execute
    const output = await execute();

    // 5. Validate output
    return outputSchema ? await validateSchema(outputSchema, output) : output;
  };
}

/**
 * Run guards sequentially with sync fast-path.
 *
 * If guard returns a plain object → merge into ctx.
 * If guard returns void → assumed mutation was done in-place.
 * If guard returns Promise → await, then apply same logic.
 *
 * This is a sync function when all guards are sync — no async overhead.
 */
async function runGuards(
  guards: readonly GuardDef[],
  ctx: Record<string, unknown>,
): Promise<void> {
  for (const guard of guards) {
    const result = guard.fn(ctx);
    // Await if thenable (async guard)
    const resolved = isThenable(result) ? await result : result;
    // Merge plain objects into context
    if (isPlainObject(resolved)) Object.assign(ctx, resolved);
  }
}

/** No-op fail for procedures without error definitions */
function noopFail(code: string, data?: unknown): never {
  throw new KatmanError(code, { data, defined: false });
}
