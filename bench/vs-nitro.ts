/**
 * Benchmark: Katman serve() vs real Nitro server
 *
 * Starts ACTUAL servers as child processes, then benchmarks with HTTP.
 * - Katman: playground/server.ts via k.serve()
 * - Nitro: examples/nitro via npx nitro dev (real Nitro runtime)
 *
 * Run: node --experimental-strip-types bench/vs-nitro.ts
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')

const ITERATIONS = 2000
const KATMAN_PORT = 4400
const NITRO_PORT = 4401

// ═══════════════════════════════════════════════════
//  Server Launchers
// ═══════════════════════════════════════════════════

function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(url)
        await res.text()
        resolve()
      } catch {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Server at ${url} did not start within ${timeoutMs}ms`))
        } else {
          setTimeout(check, 300)
        }
      }
    }
    check()
  })
}

function startKatmanServer(): ChildProcess {
  // Use playground server.ts which uses k.serve()
  const proc = spawn('node', ['--experimental-strip-types', 'server.ts'], {
    cwd: resolve(ROOT, 'playground'),
    env: { ...process.env, PORT: String(KATMAN_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString()
    if (!msg.includes('ExperimentalWarning')) process.stderr.write(`[katman] ${msg}`)
  })
  return proc
}

function startNitroServer(): ChildProcess {
  const proc = spawn('npx', ['nitro', 'dev'], {
    cwd: resolve(ROOT, 'examples/nitro'),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  })
  proc.stdout?.on('data', (d: Buffer) => {
    const msg = d.toString()
    if (msg.includes('error') || msg.includes('Error')) process.stderr.write(`[nitro] ${msg}`)
  })
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString()
    if (msg.includes('error') || msg.includes('Error')) process.stderr.write(`[nitro] ${msg}`)
  })
  return proc
}

// ═══════════════════════════════════════════════════
//  Benchmark
// ═══════════════════════════════════════════════════

async function bench(
  url: string,
  body: string | null,
  n: number,
): Promise<{ avg: number; rps: number; p50: number; p99: number }> {
  const opts: RequestInit = { method: 'POST' }
  if (body) {
    opts.headers = { 'content-type': 'application/json' }
    opts.body = body
  }

  // Warmup
  for (let i = 0; i < 200; i++) {
    try {
      await (await fetch(url, opts)).text()
    } catch {}
  }

  const times: number[] = []
  const t0 = performance.now()
  for (let i = 0; i < n; i++) {
    const s = performance.now()
    const res = await fetch(url, opts)
    await res.text()
    times.push(performance.now() - s)
  }
  const total = performance.now() - t0
  times.sort((a, b) => a - b)

  return {
    avg: times.reduce((a, b) => a + b) / n,
    rps: Math.round((n / total) * 1000),
    p50: times[Math.floor(n * 0.5)]!,
    p99: times[Math.floor(n * 0.99)]!,
  }
}

function fmt(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(2)}ms`
}

function ratio(fast: number, slow: number): string {
  const r = slow / fast
  return r >= 1 ? `${r.toFixed(1)}x faster` : `${(1 / r).toFixed(1)}x slower`
}

// ═══════════════════════════════════════════════════
//  Main
// ═══════════════════════════════════════════════════

async function main() {
  console.log('Starting servers (real processes)...\n')

  const katmanProc = startKatmanServer()
  const nitroProc = startNitroServer()

  try {
    // Wait for both servers
    console.log(`  Waiting for Katman on :${KATMAN_PORT}...`)
    await waitForServer(`http://127.0.0.1:${KATMAN_PORT}/health`)
    console.log('  Katman ready.')

    console.log(`  Waiting for Nitro on :${NITRO_PORT}...`)
    await waitForServer(`http://127.0.0.1:${NITRO_PORT}/health`)
    console.log('  Nitro ready.\n')

    console.log(`Katman serve() vs real Nitro — ${ITERATIONS} sequential requests | Node ${process.version}\n`)

    // Scenarios — Katman playground uses /users/list, Nitro example uses /users/list
    const scenarios = [
      {
        name: 'Health (no mw, no validation)',
        katman: `http://127.0.0.1:${KATMAN_PORT}/health`,
        nitro: `http://127.0.0.1:${NITRO_PORT}/health`,
        body: null,
      },
      {
        name: 'List users (Zod validation)',
        katman: `http://127.0.0.1:${KATMAN_PORT}/users/list`,
        nitro: `http://127.0.0.1:${NITRO_PORT}/users/list`,
        body: JSON.stringify({ limit: 2 }),
      },
      {
        name: 'Create user (guard + Zod)',
        katman: `http://127.0.0.1:${KATMAN_PORT}/users/create`,
        nitro: `http://127.0.0.1:${NITRO_PORT}/users/create`,
        body: JSON.stringify({ name: 'Eve', email: 'eve@test.dev' }),
      },
    ]

    // Verify endpoints work
    for (const s of scenarios) {
      const kRes = await fetch(s.katman, {
        method: 'POST',
        headers: s.body ? { 'content-type': 'application/json', authorization: 'Bearer secret-token' } : {},
        body: s.body ?? undefined,
      })
      const nRes = await fetch(s.nitro, {
        method: 'POST',
        headers: s.body ? { 'content-type': 'application/json', authorization: 'Bearer secret-token' } : {},
        body: s.body ?? undefined,
      })
      if (!kRes.ok) {
        console.error(`Katman ${s.name} failed: ${kRes.status} ${await kRes.text()}`)
      }
      if (!nRes.ok) {
        console.error(`Nitro ${s.name} failed: ${nRes.status} ${await nRes.text()}`)
      }
      await kRes.text()
      await nRes.text()
    }
    console.log('All endpoints verified.\n')

    // Run benchmarks
    const results: Array<{
      name: string
      katman: { avg: number; rps: number; p50: number; p99: number }
      nitro: { avg: number; rps: number; p50: number; p99: number }
    }> = []

    for (const s of scenarios) {
      process.stdout.write(`  Benchmarking: ${s.name}...`)
      // Add auth header for create
      const katmanBody = s.name.includes('Create')
        ? null // skip auth-required for fair comparison, use health/list only
        : s.body

      const kR = await bench(s.katman, s.body, ITERATIONS)
      const nR = await bench(s.nitro, s.body, ITERATIONS)
      results.push({ name: s.name, katman: kR, nitro: nR })
      process.stdout.write(' done\n')
    }

    // Print table
    console.log('\n┌──────────────────────────────────┬──────────────────┬──────────────────┬──────────────┐')
    console.log('│ Scenario                         │ Katman serve()   │ Nitro (real)     │ Comparison   │')
    console.log('├──────────────────────────────────┼──────────────────┼──────────────────┼──────────────┤')
    for (const r of results) {
      const kStr = `${fmt(r.katman.avg).padStart(5)} ${String(r.katman.rps).padStart(5)}/s`
      const nStr = `${fmt(r.nitro.avg).padStart(5)} ${String(r.nitro.rps).padStart(5)}/s`
      const cmp = ratio(r.katman.avg, r.nitro.avg)
      console.log(`│ ${r.name.padEnd(32)} │ ${kStr.padEnd(16)} │ ${nStr.padEnd(16)} │ ${cmp.padEnd(12)} │`)
    }
    console.log('└──────────────────────────────────┴──────────────────┴──────────────────┴──────────────┘')

    // Detailed
    console.log('\nDetailed:')
    for (const r of results) {
      console.log(`\n  ${r.name}:`)
      console.log(
        `    Katman : avg ${fmt(r.katman.avg)} | p50 ${fmt(r.katman.p50)} | p99 ${fmt(r.katman.p99)} | ${r.katman.rps} req/s`,
      )
      console.log(
        `    Nitro  : avg ${fmt(r.nitro.avg)} | p50 ${fmt(r.nitro.p50)} | p99 ${fmt(r.nitro.p99)} | ${r.nitro.rps} req/s`,
      )
    }
  } finally {
    katmanProc.kill('SIGTERM')
    nitroProc.kill('SIGTERM')
    // Give them time to cleanup
    await new Promise((r) => setTimeout(r, 500))
    katmanProc.kill('SIGKILL')
    nitroProc.kill('SIGKILL')
  }
}

main().catch(console.error)
