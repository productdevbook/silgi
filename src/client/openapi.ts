/**
 * OpenAPI Client Link — consume any OpenAPI endpoint as a Katman client.
 *
 * Unlike RPCLink (which uses Katman's wire protocol), OpenAPILink sends
 * standard REST requests based on an OpenAPI spec.
 *
 * @example
 * ```ts
 * import { OpenAPILink } from "katman/client/openapi"
 * import { createClient } from "katman/client"
 *
 * const link = new OpenAPILink({
 *   url: "https://api.example.com",
 *   spec: await fetch("/openapi.json").then(r => r.json()),
 * })
 *
 * const client = createClient<ExternalAPI>(link)
 * const users = await client.users.list({ limit: 10 })
 * ```
 */

import { KatmanError } from '../core/error.ts'

import type { ClientLink, ClientContext, ClientOptions } from './types.ts'

export interface OpenAPILinkOptions {
  /** Base URL of the API */
  url: string
  /** OpenAPI 3.x specification object (parsed JSON) */
  spec?: Record<string, unknown>
  /** Default headers */
  headers?: Record<string, string> | (() => Record<string, string>)
  /** Custom fetch implementation */
  fetch?: typeof globalThis.fetch
}

/**
 * A ClientLink that makes REST requests to an OpenAPI endpoint.
 *
 * Maps procedure paths to REST paths:
 * - `client.users.list({ limit: 10 })` → `GET /users/list?limit=10` or `POST /users/list`
 *
 * Without a spec, it defaults to POST requests with JSON body.
 * With a spec, it uses the correct HTTP method and parameter placement.
 */
export class OpenAPILink<TCtx extends ClientContext = ClientContext> implements ClientLink<TCtx> {
  #url: string
  #spec: Record<string, unknown> | undefined
  #headers: Record<string, string> | (() => Record<string, string>)
  #fetch: typeof globalThis.fetch

  constructor(options: OpenAPILinkOptions) {
    this.#url = options.url.replace(/\/$/, '')
    this.#spec = options.spec
    this.#headers = options.headers ?? {}
    this.#fetch = options.fetch ?? globalThis.fetch
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<TCtx>): Promise<unknown> {
    const endpoint = '/' + path.join('/')
    const url = this.#url + endpoint

    // Resolve headers
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...(typeof this.#headers === 'function' ? this.#headers() : this.#headers),
    }

    // Determine method from spec or default to POST
    let method = 'POST'
    if (this.#spec) {
      const paths = this.#spec.paths as Record<string, Record<string, unknown>> | undefined
      if (paths?.[endpoint]) {
        if (paths[endpoint].get) method = 'GET'
        else if (paths[endpoint].post) method = 'POST'
        else if (paths[endpoint].put) method = 'PUT'
        else if (paths[endpoint].patch) method = 'PATCH'
        else if (paths[endpoint].delete) method = 'DELETE'
      }
    }

    let requestUrl = url
    let body: string | undefined

    if (method === 'GET' || method === 'HEAD') {
      // Input as query parameters
      if (input && typeof input === 'object') {
        const params = new URLSearchParams()
        for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
          if (v !== undefined) params.set(k, String(v))
        }
        const qs = params.toString()
        if (qs) requestUrl = `${url}?${qs}`
      }
    } else {
      body = input !== undefined ? JSON.stringify(input) : undefined
    }

    const response = await this.#fetch(requestUrl, {
      method,
      headers,
      body,
      signal: options.signal,
    })

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null)
      throw new KatmanError(errorBody?.code ?? `HTTP_${response.status}`, {
        status: response.status,
        message: errorBody?.message ?? response.statusText,
        data: errorBody,
      })
    }

    return response.json()
  }
}
