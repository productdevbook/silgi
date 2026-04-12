/**
 * Core utilities — minimal, zero-allocation where possible.
 */

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
