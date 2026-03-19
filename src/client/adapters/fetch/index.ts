/**
 * Fetch transport — HTTP client for browser and Node.js.
 */

import { KatmanError, isKatmanErrorJSON, fromKatmanErrorJSON, isErrorStatus } from '../../../core/error.ts'
import { stringifyJSON, parseEmptyableJSON } from '../../../core/utils.ts'

import type { ClientLink, ClientContext, ClientOptions } from '../../types.ts'

export interface RPCLinkOptions<TClientContext extends ClientContext = ClientContext> {
  url: string | URL
  headers?: Record<string, string> | ((options: ClientOptions<TClientContext>) => Record<string, string>)
  fetch?: typeof globalThis.fetch
  method?: 'GET' | 'POST'
  maxUrlLength?: number
}

export class RPCLink<TClientContext extends ClientContext = ClientContext> implements ClientLink<TClientContext> {
  #baseUrl: string
  #headers: RPCLinkOptions<TClientContext>['headers']
  #fetch: typeof globalThis.fetch
  #method: 'GET' | 'POST'
  #maxUrlLength: number

  constructor(options: RPCLinkOptions<TClientContext>) {
    this.#baseUrl = typeof options.url === 'string' ? options.url : options.url.href
    if (this.#baseUrl.endsWith('/')) {
      this.#baseUrl = this.#baseUrl.slice(0, -1)
    }
    this.#headers = options.headers
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.#method = options.method ?? 'POST'
    this.#maxUrlLength = options.maxUrlLength ?? 2083
  }

  async call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown> {
    // Build URL
    const urlPath = path.map(encodeURIComponent).join('/')
    let url = `${this.#baseUrl}/${urlPath}`

    // Resolve headers
    const headers: Record<string, string> = {
      ...(typeof this.#headers === 'function' ? this.#headers(options) : this.#headers),
    }

    let method = this.#method
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

    const responseText = await response.text()
    const responseBody = responseText ? parseEmptyableJSON(responseText) : undefined

    if (isErrorStatus(response.status)) {
      if (isKatmanErrorJSON(responseBody)) {
        throw fromKatmanErrorJSON(responseBody)
      }
      throw new KatmanError('INTERNAL_SERVER_ERROR', {
        status: response.status,
        message: `HTTP ${response.status}`,
        data: responseBody,
      })
    }

    return responseBody
  }
}
