/**
 * StandardHandler — the core request dispatch engine.
 *
 * Three-layer interceptor architecture:
 * 1. rootInterceptors — outermost (CORS, CSRF, batch)
 * 2. interceptors — after match (auth, logging)
 * 3. clientInterceptors — per-procedure (access control)
 *
 * Uses the RPC codec for proper serialization with type metadata.
 * Supports SSE streaming for async iterator outputs.
 */

import type { Context, StandardLazyRequest, StandardResponse } from "../../../core/types.ts";
import type { Interceptor } from "../../../core/interceptor.ts";
import type { AnyRouter } from "../../router.ts";
import type { AnyProcedure } from "../../procedure.ts";
import { isProcedure } from "../../procedure.ts";
import { compilePipeline } from "../../../core/pipeline.ts";
import { validateSchema } from "../../../core/schema.ts";
import { ValidationError } from "../../../core/schema.ts";
import { createErrorConstructorMap } from "../../error.ts";
import { KatmanError, toKatmanError } from "../../../core/error.ts";
import { isLazy, unlazy } from "../../lazy.ts";
import { decodeRequest, encodeResponse, encodeErrorResponse } from "./codec.ts";
import { iteratorToEventStream } from "../../../core/sse.ts";

export interface HandlerResult {
  matched: boolean;
  response?: StandardResponse;
}

export interface StandardHandlerOptions<TContext extends Context = Context> {
  rootInterceptors?: Interceptor<HandlerResult>[];
  interceptors?: Interceptor<unknown>[];
  clientInterceptors?: Interceptor<unknown>[];
  plugins?: StandardHandlerPlugin<TContext>[];
}

export interface StandardHandlerPlugin<TContext extends Context = Context> {
  order?: number;
  init?(options: StandardHandlerOptions<TContext>, router: AnyRouter): void;
}

export class StandardHandler<TContext extends Context = Context> {
  #router: AnyRouter;
  #options: StandardHandlerOptions<TContext>;
  #pipelineCache = new WeakMap<AnyProcedure, ReturnType<typeof compilePipeline>>();

  constructor(router: AnyRouter, options: StandardHandlerOptions<TContext> = {}) {
    this.#router = router;
    this.#options = options;

    // Initialize plugins (sorted by order)
    const plugins = [...(options.plugins ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    for (const plugin of plugins) {
      plugin.init?.(this.#options, this.#router);
    }
  }

  async handle(
    request: StandardLazyRequest,
    handlerOptions: { context: TContext; prefix?: string },
  ): Promise<HandlerResult> {
    const { context, prefix } = handlerOptions;

    try {
      // Match procedure from path
      const pathname = request.url.pathname;
      const procedurePath = prefix
        ? pathname.slice(prefix.length)
        : pathname;

      const pathSegments = procedurePath.split("/").filter(Boolean);
      const procedure = await this.#findProcedure(this.#router, pathSegments);

      if (!procedure) {
        return { matched: false };
      }

      // Get or compile pipeline (cached per procedure instance)
      let pipeline = this.#pipelineCache.get(procedure);
      if (!pipeline) {
        const def = procedure["~katman"];
        const inputValidate = def.inputSchema
          ? (val: unknown) => validateSchema(def.inputSchema!, val)
          : undefined;
        const outputValidate = def.outputSchema
          ? (val: unknown) => validateSchema(def.outputSchema!, val)
          : undefined;

        pipeline = compilePipeline(
          def.middlewares,
          def.handler,
          inputValidate,
          outputValidate,
          {
            inputValidationIndex: def.inputValidationIndex,
            outputValidationIndex: def.outputValidationIndex,
          },
        );
        this.#pipelineCache.set(procedure, pipeline);
      }

      // Decode input using the RPC codec
      const input = await decodeRequest(request);

      // Execute pipeline
      const errors = createErrorConstructorMap(procedure["~katman"].errorMap);
      const output = await pipeline(
        context,
        input,
        request.signal,
        pathSegments,
        procedure["~katman"].meta,
        errors,
      );

      // Check if output is an async iterator (SSE streaming)
      if (output && typeof output === "object" && Symbol.asyncIterator in (output as object)) {
        const stream = iteratorToEventStream(
          output as AsyncIterableIterator<unknown>,
          { initialComment: "connected" },
        );
        return {
          matched: true,
          response: {
            status: procedure["~katman"].route.successStatus ?? 200,
            headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
            body: stream,
          },
        };
      }

      // Encode response with type metadata
      return { matched: true, response: encodeResponse(output, procedure) };
    } catch (error) {
      // Convert validation errors to BAD_REQUEST
      if (error instanceof ValidationError) {
        const katmanError = new KatmanError("BAD_REQUEST", {
          data: { issues: error.issues },
          cause: error,
        });
        return { matched: true, response: encodeErrorResponse(katmanError) };
      }

      const katmanError = toKatmanError(error);
      return { matched: true, response: encodeErrorResponse(katmanError) };
    }
  }

  async #findProcedure(router: AnyRouter, path: string[]): Promise<AnyProcedure | undefined> {
    // Resolve lazy routers
    let current: unknown = router;
    if (isLazy(current)) {
      current = (await unlazy(current)).default;
    }

    if (isProcedure(current)) {
      return path.length === 0 ? current : undefined;
    }

    if (path.length === 0) return undefined;

    const [head, ...tail] = path;
    const child = (current as Record<string, unknown>)[head!];
    if (!child) return undefined;

    // Resolve lazy child
    const resolved = isLazy(child) ? (await unlazy(child)).default : child;
    return this.#findProcedure(resolved as AnyRouter, tail);
  }
}
