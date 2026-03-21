import { afterAll, describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgiBroker, BrokerLink } from '#src/broker/index.ts'
import { natsBroker } from '#src/broker/nats.ts'
import { createClient } from '#src/client/client.ts'
import { SilgiError } from '#src/core/error.ts'
import { silgi } from '#src/silgi.ts'

import type { NatsConnection } from '#src/broker/nats.ts'

// ── Test Router ─────────────────────────────────────

const k = silgi({ context: () => ({}) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  add: k.$input(z.object({ a: z.number(), b: z.number() })).$resolve(({ input }) => ({ sum: input.a + input.b })),
  slow: k.$resolve(async () => {
    await new Promise((r) => setTimeout(r, 50))
    return { delayed: true }
  }),
  fail: k.$resolve(() => {
    throw new SilgiError('TEAPOT', { status: 418, message: 'I am a teapot' })
  }),
  nested: {
    deep: {
      value: k.$resolve(() => ({ nested: true })),
    },
  },
})

// ── Connection Setup ────────────────────────────────

let nc: NatsConnection | null = null
let available = false

try {
  const nats = await import('nats')
  const testNc = await nats.connect({
    servers: process.env.NATS_URL ?? 'localhost:4222',
    maxReconnectAttempts: 1,
    reconnectTimeWait: 100,
  })
  nc = testNc
  available = true
} catch {
  console.warn('⏭ NATS not available — skipping integration tests (run: docker compose up -d)')
}

afterAll(async () => {
  if (nc) await (nc as any).close()
})

// ── Tests ───────────────────────────────────────────

function uniqueSubject() {
  return `silgi.test.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`
}

describe.skipIf(!available)('Broker adapter (NATS)', () => {
  it('handles basic RPC call', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    const result = await client.health()
    expect(result).toEqual({ status: 'ok' })
    dispose()
  })

  it('passes input and validates schema', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    const result = await client.echo({ msg: 'nats-hello' })
    expect(result).toEqual({ echo: 'nats-hello' })
    dispose()
  })

  it('handles numeric computation', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    const result = await client.add({ a: 10, b: 20 })
    expect(result).toEqual({ sum: 30 })
    dispose()
  })

  it('resolves nested procedures', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    const result = await client.nested.deep.value()
    expect(result).toEqual({ nested: true })
    dispose()
  })

  it('returns SilgiError for thrown errors', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    await expect(client.fail()).rejects.toMatchObject({
      code: 'TEAPOT',
      status: 418,
      message: 'I am a teapot',
    })
    dispose()
  })

  it('returns NOT_FOUND for unknown procedure', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    await expect((client as any).nonexistent()).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    })
    dispose()
  })

  it('handles concurrent requests', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

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

  it('handles async procedures', async () => {
    const subject = uniqueSubject()
    const driver = natsBroker(nc!)
    const dispose = await silgiBroker(testRouter, driver, { subject })
    const client = createClient<typeof testRouter>(new BrokerLink(driver, { subject }))

    const result = await client.slow()
    expect(result).toEqual({ delayed: true })
    dispose()
  })

  it('supports queue groups for load balancing', async () => {
    const subject = uniqueSubject()

    // Two server instances with queue group — only one handles each request
    const driver1 = natsBroker(nc!, { queue: 'workers' })
    const driver2 = natsBroker(nc!, { queue: 'workers' })

    const dispose1 = await silgiBroker(testRouter, driver1, { subject })
    const dispose2 = await silgiBroker(testRouter, driver2, { subject })

    // Client uses either driver (they share the NATS connection)
    const clientDriver = natsBroker(nc!)
    const client = createClient<typeof testRouter>(new BrokerLink(clientDriver, { subject }))

    // Fire multiple requests — each should succeed (one of the two servers handles it)
    const results = await Promise.all(Array.from({ length: 10 }, () => client.health()))
    expect(results).toHaveLength(10)
    for (const r of results) {
      expect(r).toEqual({ status: 'ok' })
    }

    dispose1()
    dispose2()
  })

  it('isolated subjects do not interfere', async () => {
    const subject1 = uniqueSubject()
    const subject2 = uniqueSubject()
    const driver = natsBroker(nc!)

    const dispose1 = await silgiBroker(testRouter, driver, { subject: subject1 })
    const dispose2 = await silgiBroker(testRouter, driver, { subject: subject2 })

    const client1 = createClient<typeof testRouter>(new BrokerLink(driver, { subject: subject1 }))
    const client2 = createClient<typeof testRouter>(new BrokerLink(driver, { subject: subject2 }))

    const [r1, r2] = await Promise.all([client1.health(), client2.echo({ msg: 'isolated' })])

    expect(r1).toEqual({ status: 'ok' })
    expect(r2).toEqual({ echo: 'isolated' })

    dispose1()
    dispose2()
  })
})
