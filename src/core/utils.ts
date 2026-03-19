/**
 * Core utilities — minimal, zero-allocation where possible.
 */

export function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined
  return () => (cached ??= fn())
}

export function sequential<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => Promise<TReturn>,
): (...args: TArgs) => Promise<TReturn> {
  let pending: Promise<unknown> = Promise.resolve()
  return (...args: TArgs) => {
    const result = pending.then(
      () => fn(...args),
      () => fn(...args),
    )
    pending = result
    return result
  }
}

export function mergeHeaders(
  a: Record<string, string | string[] | undefined>,
  b: Record<string, string | string[] | undefined>,
): Record<string, string | string[] | undefined> {
  const result = { ...a }
  for (const key in b) {
    const bVal = b[key]
    if (bVal === undefined) continue
    const aVal = result[key]
    if (aVal === undefined) {
      result[key] = bVal
    } else {
      const aArr = Array.isArray(aVal) ? aVal : [aVal]
      const bArr = Array.isArray(bVal) ? bVal : [bVal]
      result[key] = [...aArr, ...bArr]
    }
  }
  return result
}

export function flattenHeader(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined
  return Array.isArray(value) ? value.join(', ') : value
}

export function parseEmptyableJSON(text: string): unknown {
  if (text === '') return undefined
  return JSON.parse(text)
}

export function stringifyJSON(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === 'bigint') return val.toString()
    return val
  })
}

export function mergeAbortSignals(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const defined = signals.filter((s): s is AbortSignal => s !== undefined)
  if (defined.length === 0) return undefined
  if (defined.length !== signals.length) return undefined

  const controller = new AbortController()
  let count = 0

  for (const signal of defined) {
    if (signal.aborted) {
      count++
      continue
    }
    signal.addEventListener(
      'abort',
      () => {
        if (++count === defined.length) controller.abort(signal.reason)
      },
      { once: true },
    )
  }

  if (count === defined.length) controller.abort(defined[0]!.reason)
  return controller.signal
}
