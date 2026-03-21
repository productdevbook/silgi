/**
 * Silgi vs Elysia vs oRPC — fair benchmark with same features on Bun.
 *
 * All servers have: context, 5 guards/middleware, Zod validation, POST + JSON body.
 * Uses bombardier (same methodology as Elysia's official benchmarks).
 *
 * Usage: bun bench/elysia.ts
 */

import { execSync, spawn } from 'node:child_process'

// ── Helpers ──────────────────────────────────────────

function runBombardier(url: string, body: string, duration = '10s', connections = 512) {
  const out = execSync(
    `bombardier -c ${connections} -d ${duration} -m POST -H "Content-Type: application/json" -b '${body}' --print result --format json ${url}`,
    { encoding: 'utf-8', timeout: 60_000 },
  )
  const json = JSON.parse(out)
  return {
    rps: Math.round(json.result.rps.mean),
    avgLatency: Math.round(json.result.latency.mean),
    maxLatency: Math.round(json.result.latency.max),
  }
}

function startServer(script: string): Promise<ReturnType<typeof spawn>> {
  return new Promise((resolve) => {
    const proc = spawn('bun', [script], { stdio: ['ignore', 'pipe', 'inherit'] })
    proc.stdout!.on('data', () => resolve(proc))
  })
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Main ─────────────────────────────────────────────

async function main() {
  const DURATION = '10s'
  const CONNECTIONS = 256
  const BODY = JSON.stringify({ name: 'Alice' })
  const ORPC_BODY = JSON.stringify({ json: { name: 'Alice' } })

  console.log(`\nSilgi vs Elysia vs oRPC — POST /greet (Bun ${Bun.version})`)
  console.log(`Features: context + 5 middleware + Zod validation + JSON body`)
  console.log(`bombardier: ${CONNECTIONS} connections, ${DURATION}\n`)

  const silgiProc = await startServer('bench/elysia-silgi-server.ts')
  const elysiaProc = await startServer('bench/elysia-elysia-server.ts')
  const orpcProc = await startServer('bench/elysia-orpc-server.ts')
  await sleep(1500)

  // Verify all servers
  const sCheck = await (
    await fetch('http://127.0.0.1:4400/greet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    })
  ).json()
  const eCheck = await (
    await fetch('http://127.0.0.1:4401/greet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: BODY,
    })
  ).json()
  const oCheck = await (
    await fetch('http://127.0.0.1:4402/greet', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: ORPC_BODY,
    })
  ).json()

  console.log('Silgi:', JSON.stringify(sCheck))
  console.log('Elysia:', JSON.stringify(eCheck))
  console.log('oRPC:', JSON.stringify(oCheck))
  console.log('')

  try {
    console.log('Benchmarking Silgi...')
    const silgiResult = runBombardier('http://127.0.0.1:4400/greet', BODY, DURATION, CONNECTIONS)
    await sleep(1000)

    console.log('Benchmarking Elysia...')
    const elysiaResult = runBombardier('http://127.0.0.1:4401/greet', BODY, DURATION, CONNECTIONS)
    await sleep(1000)

    console.log('Benchmarking oRPC...')
    const orpcResult = runBombardier('http://127.0.0.1:4402/greet', ORPC_BODY, DURATION, CONNECTIONS)

    const sVsE = (silgiResult.rps / elysiaResult.rps).toFixed(2)
    const sVsO = (silgiResult.rps / orpcResult.rps).toFixed(2)

    console.log('')
    console.log('| Framework | RPS | Avg Latency | Max Latency | vs Silgi |')
    console.log('|---|---|---|---|---|')
    console.log(
      `| **Silgi** | ${silgiResult.rps.toLocaleString()}/s | ${silgiResult.avgLatency}µs | ${silgiResult.maxLatency}µs | — |`,
    )
    console.log(
      `| **Elysia** | ${elysiaResult.rps.toLocaleString()}/s | ${elysiaResult.avgLatency}µs | ${elysiaResult.maxLatency}µs | Silgi ${sVsE}x |`,
    )
    console.log(
      `| **oRPC** | ${orpcResult.rps.toLocaleString()}/s | ${orpcResult.avgLatency}µs | ${orpcResult.maxLatency}µs | Silgi ${sVsO}x |`,
    )
  } finally {
    silgiProc.kill()
    elysiaProc.kill()
    orpcProc.kill()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
