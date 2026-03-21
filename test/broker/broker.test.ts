import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgiBroker, BrokerLink, memoryBroker } from '#src/broker/index.ts'
import { createClient } from '#src/client/client.ts'
import { SilgiError } from '#src/core/error.ts'
import { silgi } from '#src/silgi.ts'

// ── Test Router ─────────────────────────────────────

const k = silgi({ context: () => ({ db: 'test-db' }) })

const authGuard = k.guard({
  errors: { UNAUTHORIZED: 401 },
  fn: (ctx) => {
    if (ctx.token !== 'valid') throw new SilgiError('UNAUTHORIZED', { status: 401 })
    return { userId: 'u1' }
  },
})

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  add: k.$input(z.object({ a: z.number(), b: z.number() })).$resolve(({ input }) => ({ sum: input.a + input.b })),
  ctx: k.$resolve(({ ctx }) => ({ db: ctx.db })),
  fail: k.$resolve(() => {
    throw new SilgiError('TEAPOT', { status: 418, message: 'I am a teapot' })
  }),
  nested: {
    deep: {
      value: k.$resolve(() => ({ nested: true })),
    },
  },
  protected: k.$use(authGuard).$resolve(({ ctx }) => ({ userId: ctx.userId })),
})

// ── Helpers ─────────────────────────────────────────

async function setup(options?: { subject?: string }) {
  const driver = memoryBroker()
  const dispose = await silgiBroker(testRouter, driver, {
    subject: options?.subject,
    context: () => ({ db: 'test-db', token: 'valid' }),
  })
  const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject: options?.subject }))
  return { driver, dispose, client }
}

// ── Tests ───────────────────────────────────────────

describe('Broker adapter (memoryBroker)', () => {
  it('handles basic RPC call', async () => {
    const { client, dispose } = await setup()
    const result = await client.health()
    expect(result).toEqual({ status: 'ok' })
    dispose()
  })

  it('passes input through schema validation', async () => {
    const { client, dispose } = await setup()
    const result = await client.echo({ msg: 'hello' })
    expect(result).toEqual({ echo: 'hello' })
    dispose()
  })

  it('handles numeric input', async () => {
    const { client, dispose } = await setup()
    const result = await client.add({ a: 2, b: 3 })
    expect(result).toEqual({ sum: 5 })
    dispose()
  })

  it('injects context from options', async () => {
    const { client, dispose } = await setup()
    const result = await client.ctx()
    expect(result).toEqual({ db: 'test-db' })
    dispose()
  })

  it('resolves nested procedures', async () => {
    const { client, dispose } = await setup()
    const result = await client.nested.deep.value()
    expect(result).toEqual({ nested: true })
    dispose()
  })

  it('returns SilgiError for thrown errors', async () => {
    const { client, dispose } = await setup()
    await expect(client.fail()).rejects.toMatchObject({
      code: 'TEAPOT',
      status: 418,
      message: 'I am a teapot',
    })
    dispose()
  })

  it('returns NOT_FOUND for unknown procedure', async () => {
    const { client, dispose } = await setup()
    await expect((client as any).nonexistent()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    dispose()
  })

  it('returns BAD_REQUEST for invalid input', async () => {
    const { client, dispose } = await setup()
    await expect((client.echo as any)({ msg: 123 })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      status: 400,
    })
    dispose()
  })

  it('propagates guard errors', async () => {
    const driver = memoryBroker()
    const dispose = await silgiBroker(testRouter, driver, {
      context: () => ({ db: 'test-db', token: 'invalid' }),
    })
    const client = createClient<typeof testRouter>(new BrokerLink(driver))

    await expect(client.protected()).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
    dispose()
  })

  it('supports custom subject', async () => {
    const { client, dispose } = await setup({ subject: 'custom.rpc' })
    const result = await client.health()
    expect(result).toEqual({ status: 'ok' })
    dispose()
  })

  it('rejects when no subscriber exists', async () => {
    const driver = memoryBroker()
    const client = createClient<typeof testRouter>(new BrokerLink(driver))
    await expect(client.health()).rejects.toThrow('No subscriber')
  })

  it('handles concurrent requests', async () => {
    const { client, dispose } = await setup()
    const results = await Promise.all([
      client.add({ a: 1, b: 2 }),
      client.add({ a: 3, b: 4 }),
      client.add({ a: 5, b: 6 }),
      client.echo({ msg: 'concurrent' }),
      client.health(),
    ])
    expect(results).toEqual([{ sum: 3 }, { sum: 7 }, { sum: 11 }, { echo: 'concurrent' }, { status: 'ok' }])
    dispose()
  })

  it('cleanup stops accepting new requests', async () => {
    const { client, dispose } = await setup()

    // Should work before dispose
    const result = await client.health()
    expect(result).toEqual({ status: 'ok' })

    // Dispose the server
    dispose()

    // Should fail after dispose
    await expect(client.health()).rejects.toThrow('No subscriber')
  })

  it('handles request timeout', async () => {
    const driver = memoryBroker()

    // Subscribe but never reply
    driver.subscribe('silgi', (_payload, _reply) => {
      // intentionally never call reply()
    })

    const client = createClient<typeof testRouter>(new BrokerLink(driver, { timeout: 50 }))

    await expect(client.health()).rejects.toThrow('timeout')
  })

  it('multiple servers on same subject — routes to first', async () => {
    const driver = memoryBroker()

    const dispose1 = await silgiBroker(testRouter, driver, {
      context: () => ({ db: 'server-1', token: 'valid' }),
    })
    const dispose2 = await silgiBroker(testRouter, driver, {
      context: () => ({ db: 'server-2', token: 'valid' }),
    })

    const client = createClient<typeof testRouter>(new BrokerLink(driver))
    const result = await client.ctx()

    // First subscriber gets the request
    expect(result).toEqual({ db: 'server-1' })

    dispose1()
    dispose2()
  })

  it('fails gracefully on malformed JSON payload', async () => {
    const driver = memoryBroker()
    await silgiBroker(testRouter, driver)

    // Manually send malformed payload
    const raw = await driver.request('silgi', '{{not-json}}')
    const res = JSON.parse(raw)
    expect(res.e).toMatchObject({ code: 'BAD_REQUEST', status: 400 })
  })
})
