/**
 * Standalone worker service — runs as a separate process.
 * Listens for RPC calls over NATS and handles them.
 *
 * Start: node --experimental-strip-types server/rpc/broker/worker.ts
 */
import { connect } from 'nats'
import { silgiBroker } from 'silgi/broker'
import { natsBroker } from 'silgi/broker/nats'

import { workerRouter } from './index'

const nc = await connect({ servers: process.env.NATS_URL ?? 'localhost:4222' })
const driver = natsBroker(nc, { queue: 'workers' })

await silgiBroker(workerRouter, driver, { subject: 'worker.rpc' })

console.log('Worker listening on NATS subject: worker.rpc')
