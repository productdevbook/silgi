/**
 * Shared factory for fetch-passthrough adapters.
 *
 * Next.js, Astro, Remix, SvelteKit, and SolidStart all do the same thing:
 * lazy-init a silgi handler → strip URL prefix → rewrite request → dispatch.
 *
 * This module eliminates the duplication. Each adapter file becomes a thin
 * wrapper that extracts the framework-specific Request and calls this factory.
 */

import type { RouterDef } from '../types.ts'

export interface FetchAdapterConfig<TCtx extends Record<string, unknown>> {
  /** Route prefix to strip. Default: "/api/rpc" */
  prefix?: string
  /** Context factory — receives the Request (or framework event via eventMap). */
  context?: (req: Request) => TCtx | Promise<TCtx>
}

/**
 * For adapters where the context factory needs access to a framework event
 * (SvelteKit RequestEvent, SolidStart event), use this extended config.
 */
export interface FetchAdapterConfigWithEvent<TCtx extends Record<string, unknown>, TEvent = any> {
  prefix?: string
  /** Context factory — receives the framework event, not raw Request. */
  context?: (event: TEvent) => TCtx | Promise<TCtx>
}

/**
 * Create a fetch-passthrough adapter that strips a prefix and delegates to silgi handler.
 * Used by adapters that receive a standard Request (Next.js, Astro, Remix).
 */
export function createFetchAdapter<TCtx extends Record<string, unknown>>(
  router: RouterDef,
  options: FetchAdapterConfig<TCtx>,
  defaultPrefix: string,
): (request: Request) => Promise<Response> {
  const prefix = options.prefix ?? defaultPrefix
  let _handler: ((req: Request) => Response | Promise<Response>) | null = null
  let _initPromise: Promise<void> | null = null

  function ensureHandler(): Promise<void> {
    if (_handler) return Promise.resolve()
    return (_initPromise ??= import('../silgi.ts').then(({ silgi }) => {
      const k = silgi({ context: options.context ?? (() => ({}) as TCtx) })
      _handler = k.handler(router)
    }))
  }

  return async (request: Request): Promise<Response> => {
    await ensureHandler()
    const url = new URL(request.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }
    return _handler!(new Request(new URL(pathname + url.search, url.origin), request))
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
): (event: TEvent) => Promise<Response> {
  const prefix = options.prefix ?? defaultPrefix
  let _handler: ((req: Request) => Response | Promise<Response>) | null = null
  let _initPromise: Promise<void> | null = null
  const requestEventMap = new WeakMap<Request, TEvent>()

  function ensureHandler(): Promise<void> {
    if (_handler) return Promise.resolve()
    return (_initPromise ??= import('../silgi.ts').then(({ silgi }) => {
      const k = silgi({
        context: (_req: Request) => {
          const eventRef = requestEventMap.get(_req)
          if (options.context && eventRef) return options.context(eventRef)
          return {} as TCtx
        },
      })
      _handler = k.handler(router)
    }))
  }

  return async (event: TEvent): Promise<Response> => {
    await ensureHandler()
    const request = extractRequest(event)
    const url = new URL(request.url)
    let pathname = url.pathname
    if (pathname.startsWith(prefix)) {
      pathname = pathname.slice(prefix.length)
      if (!pathname.startsWith('/')) pathname = '/' + pathname
    }
    const rewritten = new Request(new URL(pathname + url.search, url.origin), request)
    requestEventMap.set(rewritten, event)
    return _handler!(rewritten)
  }
}
