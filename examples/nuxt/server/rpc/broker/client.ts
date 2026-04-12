/**
 * NATS broker client — used by the Nuxt server to call the worker.
 */
import { connect } from 'nats'
import { BrokerLink } from 'silgi/broker'
import { natsBroker } from 'silgi/broker/nats'
import { createClient } from 'silgi/client'

import type { WorkerRouter } from './index'

let _client: ReturnType<typeof createClient<WorkerRouter>> | null = null

export async function getWorkerClient() {
  if (_client) return _client

  const nc = await connect({ servers: process.env.NATS_URL ?? 'localhost:4222' })
  const driver = natsBroker(nc)
  _client = createClient<WorkerRouter>(new BrokerLink(driver, { subject: 'worker.rpc' }))

  return _client
}
