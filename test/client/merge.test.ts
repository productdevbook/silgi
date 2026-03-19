import { describe, it, expect } from 'vitest'

import { mergeClients } from '#src/client/merge.ts'

describe('mergeClients', () => {
  it('merges client objects', () => {
    const a = { list: () => 'a' }
    const b = { list: () => 'b' }
    const merged = mergeClients({ users: a, billing: b })
    expect(merged.users.list()).toBe('a')
    expect(merged.billing.list()).toBe('b')
  })
})
