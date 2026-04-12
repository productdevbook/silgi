import { describe, it, expect } from 'vitest'

import { compileProcedure } from '#src/compile.ts'
import { lifecycleWrap } from '#src/lifecycle.ts'

describe('lifecycleWrap()', () => {
  it('calls onStart and onSuccess', async () => {
    const events: string[] = []
    const lc = lifecycleWrap({
      onStart: () => {
        events.push('start')
      },
      onSuccess: () => {
        events.push('success')
      },
      onFinish: () => {
        events.push('finish')
      },
    })

    const proc = compileProcedure({
      type: 'query',
      input: null,
      output: null,
      errors: null,
      use: [lc],
      resolve: () => 'ok',
      route: null,
      meta: null,
    })

    await proc({}, undefined, AbortSignal.timeout(5000))
    expect(events).toEqual(['start', 'success', 'finish'])
  })

  it('calls onError on failure', async () => {
    const events: string[] = []
    const lc = lifecycleWrap({
      onError: () => {
        events.push('error')
      },
      onFinish: () => {
        events.push('finish')
      },
    })

    const proc = compileProcedure({
      type: 'query',
      input: null,
      output: null,
      errors: null,
      use: [lc],
      resolve: () => {
        throw new Error('boom')
      },
      route: null,
      meta: null,
    })

    await expect(proc({}, undefined, AbortSignal.timeout(5000))).rejects.toThrow('boom')
    expect(events).toEqual(['error', 'finish'])
  })
})
