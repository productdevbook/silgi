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
import type { RouterDef } from '../types.ts'

export interface FetchAdapterConfig<TCtx extends Record<string, unknown>> extends WrapHandlerOptions {
  /** Route prefix to strip. Default: "/api" */
  prefix?: string
  /** Context factory — receives the Request (or framework event via eventMap). */
  context?: (req: Request) => TCtx | Promise<TCtx>
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
}

/** Strip prefix from request URL and create a rewritten Request. */
function rewriteRequest(request: Request, prefix: string): Request {
  const url = new URL(request.url)
  let pathname = url.pathname
  if (pathname.startsWith(prefix)) {
    pathname = pathname.slice(prefix.length)
    if (!pathname.startsWith('/')) pathname = '/' + pathname
  }
  return new Request(new URL(pathname + url.search, url.origin), request)
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
  const handler = wrapHandler(
    createFetchHandler(router, contextFactory as (req: Request) => Record<string, unknown>),
    router,
    options,
  )

  return (request: Request): Response | Promise<Response> => {
    return handler(rewriteRequest(request, prefix))
  }
}

/**
 * Create a fetch-passthrough adapter for frameworks that pass an event object
 * with a `.request` property (SvelteKit, SolidStart).
 * Uses a WeakMap to safely pass the event into the context factory per-request.
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
    createFetchHandler(router, (_req: Request) => {
      const eventRef = requestEventMap.get(_req)
      if (options.context && eventRef)
        return options.context(eventRef) as Record<string, unknown> | Promise<Record<string, unknown>>
      return {} as Record<string, unknown>
    }),
    router,
    options,
  )

  return (event: TEvent): Response | Promise<Response> => {
    const request = extractRequest(event)
    const rewritten = rewriteRequest(request, prefix)
    requestEventMap.set(rewritten, event)
    return handler(rewritten)
  }
}
