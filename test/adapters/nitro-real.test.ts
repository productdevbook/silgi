/**
 * Nitro v3 adapter — real dev server integration test.
 *
 * Uses Nitro's programmatic API (createNitro + createDevServer)
 * to spin up a real server with Silgi routes and test via HTTP.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createNitro, createDevServer, prepare, build } from 'nitro/builder'
import { afterAll, beforeAll, describe, it, expect } from 'vitest'

import type { Nitro } from 'nitro/types'

const fixtureDir = fileURLToPath(new URL('./nitro-fixture', import.meta.url))

let serverUrl: string
let nitro: Nitro
let close: () => Promise<void>

beforeAll(async () => {
  nitro = await createNitro({ rootDir: fixtureDir, dev: true })
  const devServer = createDevServer(nitro)
  const listener = await devServer.listen({ port: 0 })
  serverUrl = (listener.url || `http://localhost:${(listener as any).address?.port || 3000}`).replace(/\/$/, '')
  close = () => listener.close()
  await prepare(nitro)
  await build(nitro)
}, 30_000)

afterAll(async () => {
  await close?.()
  await nitro?.close()
})

describe('silgi + real Nitro v3 dev server', () => {
  it('POST /rpc/health — no-input procedure', async () => {
    const res = await fetch(`${serverUrl}/rpc/health`, { method: 'POST' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('POST /rpc/echo — with JSON body', async () => {
    const res = await fetch(`${serverUrl}/rpc/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'nitro-real' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.echo).toBe('nitro-real')
  })

  it('GET /rpc/greet?data= — GET with query params', async () => {
    const query = encodeURIComponent(JSON.stringify({ name: 'Nitro' }))
    const res = await fetch(`${serverUrl}/rpc/greet?data=${query}`, { method: 'GET' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.hello).toBe('Nitro')
  })

  it('POST /rpc/echo — validation error', async () => {
    const res = await fetch(`${serverUrl}/rpc/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: 'field' }),
    })
    const text = await res.text()
    const data = JSON.parse(text)
    // Silgi returns {code, status, message} but Nitro may wrap in {error, data}
    const code = data.code || data.data?.code
    expect(code).toBe('BAD_REQUEST')
  })

  it('POST /rpc/unknown — not found', async () => {
    const res = await fetch(`${serverUrl}/rpc/unknown`, { method: 'POST' })
    const data = await res.json()
    expect(data.code).toBe('NOT_FOUND')
  })
})
