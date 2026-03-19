/**
 * Request Coalescing — the single biggest real-world optimization.
 *
 * When N identical requests arrive concurrently:
 * - WITHOUT coalescing: N handler executions, N stringify calls
 * - WITH coalescing: 1 handler execution, 1 stringify call, N responses
 *
 * For a typical API with 50 concurrent users hitting the same endpoint,
 * this is effectively 50x less CPU work.
 *
 * Combined with ResponseCache:
 * - First request: full pipeline → cache → respond
 * - Concurrent identical: coalesce → wait for first → respond (0 pipeline)
 * - Subsequent: cache hit → respond (0 pipeline, 0 wait)
 */

export class RequestCoalescer {
  #inflight = new Map<string, Promise<string>>()

  /**
   * Execute handler with coalescing. If an identical request is already
   * in-flight, piggyback on its result instead of executing again.
   *
   * Returns the serialized response string.
   */
  async execute(key: string, handler: () => Promise<string> | string): Promise<string> {
    // Check if this exact request is already being processed
    const existing = this.#inflight.get(key)
    if (existing) return existing

    // First request for this key — execute and share result
    const promise = (async () => {
      try {
        const result = handler()
        return result instanceof Promise ? await result : result
      } finally {
        // Remove from inflight AFTER microtask so concurrent arrivals can find it
        queueMicrotask(() => this.#inflight.delete(key))
      }
    })()

    this.#inflight.set(key, promise)
    return promise
  }

  /** Number of currently in-flight unique requests */
  get inflightCount(): number {
    return this.#inflight.size
  }
}
