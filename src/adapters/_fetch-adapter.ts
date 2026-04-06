/**
 * Shared factory for fetch-passthrough adapters.
 *
 * Next.js, Astro, Remix, SvelteKit, and SolidStart all do the same thing:
 * strip URL prefix → rewrite request → dispatch to fetch handler.
 *
 * This module eliminates the duplication. Each adapter file becomes a thin
 * wrapper that extracts the framework-specific Request and calls this factory.
 */

import { createFetchHandler } from '../core/handler.ts'

import type { FetchHandler } from '../core/handler.ts'
import type { AnalyticsOptions } from '../plugins/analytics/types.ts'
import type { ScalarOptions } from '../scalar.ts'
import type { RouterDef } from '../types.ts'

export interface FetchAdapterConfig<TCtx extends Record<string, unknown>> {
  /** Route prefix to strip. Default: "/api/rpc" */
  prefix?: string
  /** Context factory — receives the Request (or framework event via eventMap). */
  context?: (req: Request) => TCtx | Promise<TCtx>
  /** Enable analytics dashboard. Pass `true` for defaults or an options object. */
  analytics?: boolean | AnalyticsOptions
  /** Enable Scalar API reference. Pass `true` for defaults or an options object. */
  scalar?: boolean | ScalarOptions
}

/**
 * For adapters where the context factory needs access to a framework event
 * (SvelteKit RequestEvent, SolidStart event), use this extended config.
 */
export interface FetchAdapterConfigWithEvent<TCtx extends Record<string, unknown>, TEvent = any> {
  prefix?: string
  /** Context factory — receives the framework event, not raw Request. */
  context?: (event: TEvent) => TCtx | Promise<TCtx>
  /** Enable analytics dashboard. Pass `true` for defaults or an options object. */
  analytics?: boolean | AnalyticsOptions
  /** Enable Scalar API reference. Pass `true` for defaults or an options object. */
  scalar?: boolean | ScalarOptions
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

async function applyWrappers(
  h: FetchHandler,
  router: RouterDef,
  options: { analytics?: boolean | AnalyticsOptions; scalar?: boolean | ScalarOptions },
): Promise<FetchHandler> {
  if (options.scalar) {
    const { wrapWithScalar } = await import('../scalar.ts')
    const scalarOpts = typeof options.scalar === 'object' ? options.scalar : {}
    h = wrapWithScalar(h, router, scalarOpts)
  }
  if (options.analytics) {
    const { wrapWithAnalytics } = await import('../plugins/analytics.ts')
    const analyticsOpts = typeof options.analytics === 'object' ? options.analytics : {}
    h = wrapWithAnalytics(h, analyticsOpts)
  }
  return h
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
  const baseHandler = createFetchHandler(router, contextFactory as (req: Request) => Record<string, unknown>)
  const needsWrap = !!(options.scalar || options.analytics)

  let wrappedHandler: FetchHandler | undefined
  let initPromise: Promise<void> | undefined

  if (!needsWrap) {
    return (request: Request): Response | Promise<Response> => {
      return baseHandler(rewriteRequest(request, prefix))
    }
  }

  return (request: Request): Response | Promise<Response> => {
    if (wrappedHandler) return wrappedHandler(rewriteRequest(request, prefix))
    initPromise ??= applyWrappers(baseHandler, router, options).then((h) => {
      wrappedHandler = h
    })
    return initPromise.then(() => wrappedHandler!(rewriteRequest(request, prefix)))
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
  const needsWrap = !!(options.scalar || options.analytics)

  const baseHandler = createFetchHandler(router, (_req: Request) => {
    const eventRef = requestEventMap.get(_req)
    if (options.context && eventRef)
      return options.context(eventRef) as Record<string, unknown> | Promise<Record<string, unknown>>
    return {} as Record<string, unknown>
  })

  let wrappedHandler: FetchHandler | undefined
  let initPromise: Promise<void> | undefined

  function dispatch(handler: FetchHandler, event: TEvent): Response | Promise<Response> {
    const request = extractRequest(event)
    const rewritten = rewriteRequest(request, prefix)
    requestEventMap.set(rewritten, event)
    return handler(rewritten)
  }

  if (!needsWrap) {
    return (event: TEvent) => dispatch(baseHandler, event)
  }

  return (event: TEvent): Response | Promise<Response> => {
    if (wrappedHandler) return dispatch(wrappedHandler, event)
    initPromise ??= applyWrappers(baseHandler, router, options).then((h) => {
      wrappedHandler = h
    })
    return initPromise.then(() => dispatch(wrappedHandler!, event))
  }
}
