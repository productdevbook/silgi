import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { silgi } from '#src/silgi.ts'
import { minifyContractRouter } from '#src/contract.ts'

const k = silgi({ context: () => ({}) })

describe('minifyContractRouter()', () => {
  it('extracts route metadata from compiled router', () => {
    const router = k.router({
      health: k.$route({ method: 'GET', path: '/api/health' }).$resolve(() => 'ok'),
      users: {
        list: k.$route({ method: 'GET', path: '/api/users' }).$resolve(() => []),
        create: k.$route({ method: 'POST', path: '/api/users' }).$resolve(() => ({})),
        get: k.$route({ method: 'GET', path: '/api/users/:id' }).$input(z.object({ id: z.string() })).$resolve(() => null),
      },
      noRoute: k.$resolve(() => 'no custom path'),
    })

    const minified = minifyContractRouter(router)
    
    expect(minified.health).toEqual({ path: '/api/health', method: 'GET' })
    expect((minified.users as any).list).toEqual({ path: '/api/users', method: 'GET' })
    expect((minified.users as any).create).toEqual({ path: '/api/users', method: 'POST' })
    expect((minified.users as any).get).toEqual({ path: '/api/users/:id', method: 'GET' })
    expect(minified.noRoute).toBeUndefined()
  })

  it('returns empty object for non-router input', () => {
    expect(minifyContractRouter(null)).toEqual({})
    expect(minifyContractRouter(undefined)).toEqual({})
    expect(minifyContractRouter('string')).toEqual({})
  })
})
