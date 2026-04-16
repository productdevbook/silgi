/**
 * Shared factory for fetch-passthrough adapters.
 *
 * Next.js, Astro, Remix, SvelteKit, and SolidStart all do the same thing:
 * strip URL prefix → rewrite request → dispatch to fetch handler.
 *
 * This module eliminates the duplication. Each adapter file becomes a thin
 * wrapper that extracts the framework-specific Request and calls this factory.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

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
 *
 * Propagates the framework event to the context factory via a per-adapter
 * AsyncLocalStorage scope, so the lookup rides the async call chain instead
 * of Request object identity. Middleware that clones or replaces the Request
 * (body reads, URL rewrites, polyfills) no longer breaks context resolution.
 *
 * Resolves: https://github.com/productdevbook/silgi/issues/4
 */
export function createEventFetchAdapter<TCtx extends Record<string, unknown>, TEvent = any>(
  router: RouterDef,
  options: FetchAdapterConfigWithEvent<TCtx, TEvent>,
  defaultPrefix: string,
  extractRequest: (event: TEvent) => Request,
): (event: TEvent) => Response | Promise<Response> {
  const prefix = options.prefix ?? defaultPrefix
  const eventStore = new AsyncLocalStorage<TEvent>()

  const handler = wrapHandler(
    createFetchHandler(
      router,
      (_req: Request) => {
        const eventRef = eventStore.getStore()
        if (options.context && eventRef !== undefined)
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
    return eventStore.run(event, () => handler(request))
  }
}
