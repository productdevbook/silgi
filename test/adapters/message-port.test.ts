import { describe, it, expect } from 'vitest'
import { z } from 'zod'

import { silgi } from '#src/silgi.ts'

const k = silgi({ context: () => ({ db: 'test' }) })

const testRouter = k.router({
  health: k.$resolve(() => ({ status: 'ok' })),
  echo: k.$input(z.object({ msg: z.string() })).$resolve(({ input }) => ({ echo: input.msg })),
  greet: k.$input(z.object({ name: z.string() })).$resolve(({ input }) => ({ hello: input.name })),
})

describe('MessagePort adapter', () => {
  it('handles RPC over message port', async () => {
    const { createHandler, MessagePortLink } = await import('#src/adapters/message-port.ts')
    const { createClient } = await import('#src/client/client.ts')

    // Create a mock MessageChannel
    const channel = new MessageChannel()

    // Server side
    const dispose = createHandler(testRouter, channel.port1, {
      context: () => ({ db: 'test' }),
    })

    // Client side
    const link = new MessagePortLink(channel.port2)
    const client = createClient<any>(link)

    const result = await client.health()
    expect(result).toEqual({ status: 'ok' })

    const echo = await client.echo({ msg: 'hello' })
    expect(echo).toEqual({ echo: 'hello' })

    dispose()
    channel.port1.close()
    channel.port2.close()
  })

  it('returns error for unknown procedure', async () => {
    const { createHandler, MessagePortLink } = await import('#src/adapters/message-port.ts')
    const { createClient } = await import('#src/client/client.ts')

    const channel = new MessageChannel()
    const dispose = createHandler(testRouter, channel.port1, {
      context: () => ({}),
    })

    const link = new MessagePortLink(channel.port2)
    const client = createClient<any>(link)

    await expect(client.nonexistent()).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })

    dispose()
    channel.port1.close()
    channel.port2.close()
  })
})
