import type { EntryKey } from '@pinia/colada'

export type PartialDeep<T> = T extends object ? { [K in keyof T]?: PartialDeep<T[K]> } : T

export interface BuildKeyOptions<TInput> {
  type?: 'query' | 'mutation'
  input?: PartialDeep<TInput>
}

export function buildKey<TInput>(path: string[], options: BuildKeyOptions<TInput> = {}): EntryKey {
  const withInput = options.input !== undefined ? { input: options.input } : {}
  const withType = options.type !== undefined ? { type: options.type } : {}

  return [
    path,
    {
      ...withInput,
      ...(withType as any),
    },
  ]
}
