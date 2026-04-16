/**
 * Shared factory for fetch-passthrough adapters.
 *
 * Next.js, Astro, Remix, SvelteKit, and SolidStart all do the same thing:
 * strip URL prefix → rewrite request → dispatch to fetch handler.
 *
 * This module eliminates the duplication. Each adapter file becomes a thin
 * wrapper that extracts the framework-specific Request and calls this factory.
 */

import { createFetchHandler, wrapHandler } from '../core/handler.ts'

import type { FetchHandler, WrapHandlerOptions } from '../core/handler.ts'
import type { SilgiHooks } from '../silgi.ts'
import type { RouterDef } from '../types.ts'
import type { Hookable } from 'hookable'

export interface FetchAdapterConfig<TCtx extends Record<string, unknown>> extends WrapHandlerOptions {
  /** Route prefix to strip. Default: "/api" */
  prefix?: string
  /** Context factory — receives the Request (or framework event via eventMap). */
  context?: (req: Request) => TCtx | Promise<TCtx>
  /** Lifecycle hooks (request, response, error). */
  hooks?: Hookable<SilgiHooks>
}

/**
 * For adapters where the context factory needs access to a framework event
 * (SvelteKit RequestEvent, SolidStart event), use this extended config.
 */
export interface FetchAdapterConfigWithEvent<
  TCtx extends Record<string, unknown>,
  TEvent = any,
> extends WrapHandlerOptions {
  /** Route prefix to strip. Default: "/api" */
  prefix?: string
  /** Context factory — receives the framework event, not raw Request. */
  context?: (event: TEvent) => TCtx | Promise<TCtx>
  /** Lifecycle hooks (request, response, error). */
  hooks?: Hookable<SilgiHooks>
}

/**
 * Create a fetch-passthrough adapter that strips a prefix and delegates to handler.
 * Used by adapters that receive a standard Request (Next.js, Astro, Remix).
 */
export function createFetchAdapter<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: FetchAdapterConfig<TCtx>,
  defaultPrefix: string,
): FetchHandler {
  const prefix = options.prefix ?? defaultPrefix
  const contextFactory = options.context ?? (() => ({}) as TCtx)
  return wrapHandler(
    createFetchHandler(router, contextFactory as (req: Request) => Record<string, unknown>, options.hooks, prefix),
    router,
    options,
    prefix,
  )
}

/**
 * Create a fetch-passthrough adapter for frameworks that pass an event object
 * with a `.request` property (SvelteKit, SolidStart).
 * Uses a WeakMap to safely pass the event into the context factory per-request.
 *
 * ⚠️  The event is keyed by `Request` identity. If a middleware layer between
 * the framework and this adapter replaces the Request (cloning for body reads,
 * URL rewrites, or polyfills), the lookup will miss and the context factory
 * will receive no event. In practice SvelteKit/SolidStart pass their own
 * `event.request` through unchanged, so this is safe for default usage;
 * userland middleware that rewrites Request must re-seed the event itself.
 *
 * Tracking: https://github.com/productdevbook/silgi/issues/4
 */
export function createEventFetchAdapter<TCtx extends Record<string, unknown>, TEvent = any>(
  router: RouterDef,
  options: FetchAdapterConfigWithEvent<TCtx, TEvent>,
  defaultPrefix: string,
  extractRequest: (event: TEvent) => Request,
): (event: TEvent) => Response | Promise<Response> {
  const prefix = options.prefix ?? defaultPrefix
  const requestEventMap = new WeakMap<Request, TEvent>()

  const handler = wrapHandler(
    createFetchHandler(
      router,
      (_req: Request) => {
        const eventRef = requestEventMap.get(_req)
        if (options.context && eventRef)
          return options.context(eventRef) as Record<string, unknown> | Promise<Record<string, unknown>>
        return {} as Record<string, unknown>
      },
      options.hooks,
      prefix,
    ),
    router,
    options,
    prefix,
  )

  return (event: TEvent): Response | Promise<Response> => {
    const request = extractRequest(event)
    requestEventMap.set(request, event)
    return handler(request)
  }
}
