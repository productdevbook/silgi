import type { RouterContext } from './types.ts'

/**
 * Create a new router context.
 */
export function createRouter<T = unknown>(): RouterContext<T> {
  return {
    root: { key: '' },
    static: Object.create(null),
  }
}
