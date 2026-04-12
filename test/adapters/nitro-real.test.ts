/**
 * Nitro v3 — real dev server integration test.
 *
 * Uses Nitro's programmatic API (createNitro + createDevServer)
 * with serverEntry pointing to a Silgi server.ts.
 */

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
  serverUrl = (listener.url || 'http://localhost:3000').replace(/\/$/, '')
  close = () => listener.close()
  await prepare(nitro)
  await build(nitro)
}, 30_000)

afterAll(async () => {
  await close?.()
  await nitro?.close()
})

describe('silgi + real Nitro v3 dev server (serverEntry)', () => {
  it('POST /health — no-input procedure', async () => {
    const res = await fetch(`${serverUrl}/health`, { method: 'POST' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('POST /echo — with JSON body', async () => {
    const res = await fetch(`${serverUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msg: 'nitro-real' }),
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.echo).toBe('nitro-real')
  })

  it('GET /greet?data= — GET with query params', async () => {
    const query = encodeURIComponent(JSON.stringify({ name: 'Nitro' }))
    const res = await fetch(`${serverUrl}/greet?data=${query}`, { method: 'GET' })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.hello).toBe('Nitro')
  })

  it('POST /echo — validation error', async () => {
    const res = await fetch(`${serverUrl}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wrong: 'field' }),
    })
    const data = await res.json()
    expect(data.code).toBe('BAD_REQUEST')
  })

  it('POST /unknown — not found', async () => {
    const res = await fetch(`${serverUrl}/unknown`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})
