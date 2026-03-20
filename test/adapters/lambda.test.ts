import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgiLambda } from '#src/adapters/aws-lambda.ts'
import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

describe('silgiLambda()', () => {
  it('handles Lambda events', async () => {
    const router = k.router({
      health: k.$resolve(() => ({ status: 'ok' })),
      echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
    })

    const handler = silgiLambda(router, { context: () => ({}) })

    const result = await handler({
      httpMethod: 'POST',
      path: '/echo',
      body: JSON.stringify({ msg: 'hello' }),
      headers: { 'content-type': 'application/json' },
      queryStringParameters: null,
    })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ echo: 'hello' })
  })

  it('returns 404 for unknown procedures', async () => {
    const router = k.router({ health: k.$resolve(() => 'ok') })
    const handler = silgiLambda(router, { context: () => ({}) })

    const result = await handler({
      httpMethod: 'POST',
      path: '/unknown',
      body: null,
      headers: {},
      queryStringParameters: null,
    })

    expect(result.statusCode).toBe(404)
  })

  it('strips prefix', async () => {
    const router = k.router({ health: k.$resolve(() => ({ ok: true })) })
    const handler = silgiLambda(router, { prefix: '/rpc', context: () => ({}) })

    const result = await handler({
      httpMethod: 'POST',
      path: '/rpc/health',
      body: null,
      headers: {},
      queryStringParameters: null,
    })

    expect(result.statusCode).toBe(200)
    expect(JSON.parse(result.body)).toEqual({ ok: true })
  })
})
