import { buildKey } from './key.ts'

import type { BuildKeyOptions } from './key.ts'
import type { EntryKey } from '@pinia/colada'

export interface GeneralUtils<TInput> {
  /**
   * Generate a query/mutation key for checking status, invalidate, set, get, etc.
   */
  key(options?: BuildKeyOptions<TInput>): EntryKey
}

export function createGeneralUtils<TInput>(path: string[]): GeneralUtils<TInput> {
  return {
    key(options) {
      return buildKey(path, options)
    },
  }
}
