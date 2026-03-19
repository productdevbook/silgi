import { describe, it, expect } from 'vitest'

import { katman } from '#src/katman.ts'

const k = katman({ context: () => ({ db: 'test' }) })

describe('createPeer() — bidirectional RPC', () => {
  it("two peers call each other's procedures", async () => {
    const { createPeer } = await import('#src/adapters/peer.ts')

    const routerA = k.router({
      ping: k.query(() => ({ from: 'A', msg: 'pong' })),
    })

    const routerB = k.router({
      hello: k.query(() => ({ from: 'B', msg: 'world' })),
    })

    const channel = new MessageChannel()

    const peerA = createPeer(routerA, channel.port1)
    const peerB = createPeer(routerB, channel.port2)

    // Peer A calls Peer B
    const fromB = await (peerA.client as any).hello()
    expect(fromB).toEqual({ from: 'B', msg: 'world' })

    // Peer B calls Peer A
    const fromA = await (peerB.client as any).ping()
    expect(fromA).toEqual({ from: 'A', msg: 'pong' })

    peerA.dispose()
    peerB.dispose()
    channel.port1.close()
    channel.port2.close()
  })
})
