/**
 * Client Batch Plugin — coalesce multiple concurrent RPC calls
 * into a single HTTP request.
 *
 * Collects calls within a microtask boundary, sends them as
 * POST /__batch__ with an array body, and distributes responses.
 */

import type { ClientLink, ClientContext, ClientOptions } from '../types.ts'

export interface BatchLinkOptions {
  /** The underlying link to send the batch through */
  link: ClientLink
  /** Batch endpoint path (default: /__batch__) */
  path?: string
  /** Maximum batch size (default: 20) */
  maxSize?: number
  /** URL for the batch endpoint */
  url: string | URL
}

interface PendingCall {
  path: readonly string[]
  input: unknown
  options: ClientOptions
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export class BatchLink<TClientContext extends ClientContext = ClientContext> implements ClientLink<TClientContext> {
  #link: ClientLink<TClientContext>
  #batchPath: string
  #maxSize: number
  #url: string
  #pending: PendingCall[] = []
  #scheduled = false

  constructor(options: BatchLinkOptions) {
    this.#link = options.link as ClientLink<TClientContext>
    this.#batchPath = options.path ?? '/__batch__'
    this.#maxSize = options.maxSize ?? 20
    this.#url = typeof options.url === 'string' ? options.url : options.url.href
  }

  call(path: readonly string[], input: unknown, options: ClientOptions<TClientContext>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.#pending.push({ path, input, options, resolve, reject })

      if (!this.#scheduled) {
        this.#scheduled = true
        // Flush on next microtask
        queueMicrotask(() => this.#flush())
      }
    })
  }

  async #flush(): Promise<void> {
    this.#scheduled = false

    // Take all pending calls
    const batch = this.#pending.splice(0)
    if (batch.length === 0) return

    // Split into chunks if exceeding maxSize
    const chunks: PendingCall[][] = []
    for (let i = 0; i < batch.length; i += this.#maxSize) {
      chunks.push(batch.slice(i, i + this.#maxSize))
    }

    for (const chunk of chunks) {
      await this.#sendChunk(chunk)
    }
  }

  async #sendChunk(chunk: PendingCall[]): Promise<void> {
    const batchBody = chunk.map((call) => ({
      path: '/' + call.path.join('/'),
      method: 'POST',
      body: call.input,
    }))

    try {
      const result = await this.#link.call(
        [this.#batchPath.slice(1)], // Remove leading /
        batchBody,
        { signal: chunk[0]?.options.signal },
      )

      const responses = result as Array<{
        index: number
        status: number
        body?: unknown
      }>

      if (!Array.isArray(responses)) {
        for (const call of chunk) {
          call.reject(new Error('Invalid batch response'))
        }
        return
      }

      // Distribute responses
      for (const response of responses) {
        const call = chunk[response.index]
        if (!call) continue

        if (response.status >= 400) {
          call.reject(response.body ?? new Error(`HTTP ${response.status}`))
        } else {
          call.resolve(response.body)
        }
      }

      // Reject any calls that didn't get a response
      for (let i = 0; i < chunk.length; i++) {
        const call = chunk[i]!
        if (!responses.some((r) => r.index === i)) {
          call.reject(new Error('No response in batch'))
        }
      }
    } catch (error) {
      for (const call of chunk) {
        call.reject(error)
      }
    }
  }
}
