/**
 * Fetch transport — HTTP client for browser and Node.js.
 */

import { SilgiError, isSilgiErrorJSON, fromSilgiErrorJSON, isErrorStatus } from '../../../core/error.ts'
import { resolveRoute } from '../../../core/router-utils.ts'
import { stringifyJSON, parseEmptyableJSON } from '../../../core/utils.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'

export interface RPCLinkOptions<TClientContext extends ClientContext = ClientContext> {
  url: string | URL
  headers?: Record<string, string> | ((options: ClientOptions<TClientContext>) => Record<string, string>)
  fetch?: typeof globalThis.fetch
  method?: 'GET' | 'POST'
  maxUrlLength?: number
  /** Router definition — enables $route({ path }) resolution on the client */
  router?: unknown
}

export class RPCLink<TClientContext extends ClientContext = ClientContext> implements ClientLink<TClientContext> {
  #baseUrl: string
  #headers: RPCLinkOptions<TClientContext>['headers']
  #fetch: typeof globalThis.fetch
  #method: 'GET' | 'POST'
  #maxUrlLength: number
  #router: unknown

  constructor(options: RPCLinkOptions<TClientContext>) {
    this.#baseUrl = typeof options.url === 'string' ? options.url : options.url.href
    if (this.#baseUrl.endsWith('/')) {
      this.#baseUrl = this.#baseUrl.slice(0, -1)
    }
    this.#headers = options.headers
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#method = options.method ?? 'POST'
    this.#maxUrlLength = options.maxUrlLength ?? 2083
    this.#router = options.router
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown> {
    // Resolve custom $route({ path, method }) from router if available
    const resolved = this.#router ? resolveRoute(this.#router, path) : undefined
    const urlPath = resolved ? resolved.path : '/' + path.map(encodeURIComponent).join('/')
    let url = `${this.#baseUrl}${urlPath}`

    // Resolve headers
    const headers: Record<string, string> = {
      ...(typeof this.#headers === 'function' ? this.#headers(options) : this.#headers),
    }

    let method: string = resolved?.method ?? this.#method
    let body: BodyInit | undefined
    const hasInput = input !== undefined && input !== null

    if (method === 'GET' && hasInput) {
      const data = stringifyJSON(input)
      const candidateUrl = `${url}?data=${encodeURIComponent(data)}`
      if (candidateUrl.length <= this.#maxUrlLength) {
        url = candidateUrl
      } else {
        method = 'POST'
        headers['content-type'] = 'application/json'
        body = data
      }
    } else if (hasInput) {
      headers['content-type'] = 'application/json'
      body = stringifyJSON(input)
    }

    const response = await this.#fetch(url, {
      method,
      headers,
      body,
      signal: options.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    let responseBody: unknown
    if (contentType.includes('msgpack')) {
      const { decode } = await import('../../../codec/msgpack.ts')
      const buf = new Uint8Array(await response.arrayBuffer())
      responseBody = buf.length > 0 ? decode(buf) : undefined
    } else if (contentType.includes('x-devalue')) {
      const { decode } = await import('../../../codec/devalue.ts')
      const text = await response.text()
      responseBody = text ? decode(text) : undefined
    } else {
      const responseText = await response.text()
      responseBody = responseText ? parseEmptyableJSON(responseText) : undefined
    }

    if (isErrorStatus(response.status)) {
      if (isSilgiErrorJSON(responseBody)) {
        throw fromSilgiErrorJSON(responseBody)
      }
      throw new SilgiError('INTERNAL_SERVER_ERROR', {
        status: response.status,
        message: `HTTP ${response.status}`,
        data: responseBody,
      })
    }

    return responseBody
  }
}
