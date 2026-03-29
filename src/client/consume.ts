/**
 * Client-side SSE/streaming consumption utilities.
 *
 * @example
 * ```ts
 * const iterator = await client.events.subscribe()
 * await consumeIterator(iterator, {
 *   onEvent: (data) => console.log('Event:', data),
 *   onError: (err) => console.error('Error:', err),
 *   onFinish: () => console.log('Stream ended'),
 * })
 * ```
 */

export interface ConsumeOptions<T> {
  /** Called for each event value */
  onEvent?: (data: T) => void | Promise<void>
  /** Called when an error occurs */
  onError?: (error: Error) => void
  /** Called when the stream ends (success or error) */
  onFinish?: () => void
  /** AbortSignal to cancel consumption */
  signal?: AbortSignal
}

/**
 * Consume an async iterator with lifecycle callbacks.
 * Returns the final value (if any) when the iterator completes.
 */
export async function consumeIterator<T>(
  iterator: AsyncIterableIterator<T>,
  options: ConsumeOptions<T> = {},
): Promise<void> {
  const { onEvent, onError, onFinish, signal } = options
  try {
    while (true) {
      if (signal?.aborted) {
        await iterator.return?.()
        break
      }
      const result = await iterator.next()
      if (result.done) break
      if (onEvent) await onEvent(result.value)
    }
  } catch (error) {
    onError?.(error instanceof Error ? error : new Error(String(error)))
  } finally {
    onFinish?.()
  }
}

/**
 * Map values from an async iterator, producing a new iterator.
 */
export async function* mapIterator<T, U>(
  iterator: AsyncIterableIterator<T>,
  fn: (value: T) => U | Promise<U>,
): AsyncIterableIterator<U> {
  try {
    for await (const value of iterator) {
      yield await fn(value)
    }
  } finally {
    await iterator.return?.()
  }
}

export interface ReconnectOptions<T> extends ConsumeOptions<T> {
  /** Factory to create a new iterator on reconnection */
  connect: (lastEventId?: string) => AsyncIterableIterator<T> | Promise<AsyncIterableIterator<T>>
  /** Maximum reconnection attempts (default: Infinity) */
  maxReconnects?: number
  /** Delay between reconnections in ms (default: 1000) */
  reconnectDelay?: number
  /** Called on each reconnection attempt */
  onReconnect?: (attempt: number) => void
}

/**
 * Consume an iterator with automatic reconnection on failure.
 * Uses lastEventId for resumption if available.
 */
export async function consumeWithReconnect<T>(options: ReconnectOptions<T>): Promise<void> {
  const { connect, maxReconnects = Infinity, reconnectDelay = 1000, onReconnect, signal, ...consumeOpts } = options
  let lastEventId: string | undefined
  let attempt = 0

  while (attempt <= maxReconnects) {
    if (signal?.aborted) break
    try {
      const iterator = await connect(lastEventId)
      attempt = 0 // reset on successful connection
      await consumeIterator(iterator, {
        ...consumeOpts,
        signal,
        onEvent: async (data) => {
          // Extract lastEventId from event metadata if available
          if (data && typeof data === 'object' && 'id' in (data as any)) {
            lastEventId = String((data as any).id)
          }
          if (consumeOpts.onEvent) await consumeOpts.onEvent(data)
        },
      })
      break // clean exit
    } catch {
      attempt++
      if (attempt > maxReconnects || signal?.aborted) break
      onReconnect?.(attempt)
      await new Promise((resolve) => setTimeout(resolve, reconnectDelay))
    }
  }
  consumeOpts.onFinish?.()
}
