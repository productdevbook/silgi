import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { compileProcedure } from '#src/compile.ts'
import { fromTRPC } from '#src/trpc-interop.ts'

describe('fromTRPC()', () => {
  it('converts a mock tRPC router', async () => {
    const mockRouter = {
      health: {
        _def: {
          type: 'query',
          inputs: [],
          resolver: () => ({ status: 'ok' }),
        },
      },
      echo: {
        _def: {
          type: 'query',
          inputs: [z.object({ msg: z.string() })],
          resolver: ({ input }: any) => ({ echo: input.msg }),
        },
      },
    }

    const katmanRouter = fromTRPC(mockRouter)

    expect(katmanRouter.health).toBeDefined()
    expect((katmanRouter.health as any).type).toBe('query')

    const handler = compileProcedure(katmanRouter.health as any)
    const result = await handler({}, undefined, AbortSignal.timeout(5000))
    expect(result).toEqual({ status: 'ok' })
  })

  it('throws for invalid input', () => {
    expect(() => fromTRPC(null)).toThrow()
    expect(() => fromTRPC('string' as any)).toThrow()
  })
})
