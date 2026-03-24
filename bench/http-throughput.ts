/**
 * HTTP throughput benchmark — Silgi vs Fastify vs Hono vs Express.
 *
 * Uses bombardier (external load generator) with separate server processes.
 * This matches the methodology used by Hono and Elysia benchmarks.
 *
 * Install: brew install bombardier
 * Run:     node --experimental-strip-types bench/http-throughput.ts
 */

import { execSync, spawn } from 'node:child_process'
import { createConnection } from 'node:net'

const WARMUP_DURATION = 3 // seconds
const BENCH_DURATION = 10 // seconds
const CONCURRENCY = [64, 256]
const ROUNDS = 3
const BASE_PORT = 4900

interface BombardierResult {
  avg: number // µs
  p50: number
  p95: number
  p99: number
  rps: number
}

// ── Helpers ──

function waitForPort(port: number, timeout = 10000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tryConnect = () => {
      const socket = createConnection({ port, host: '127.0.0.1' })
      socket.once('connect', () => {
        socket.destroy()
        resolve()
      })
      socket.once('error', () => {
        if (Date.now() - start > timeout) {
          reject(new Error(`Port ${port} not ready after ${timeout}ms`))
        } else {
          setTimeout(tryConnect, 50)
        }
      })
    }
    tryConnect()
  })
}

function runBombardier(port: number, path: string, concurrency: number, duration: number): BombardierResult {
  const url = `http://127.0.0.1:${port}${path}`
  const cmd = `bombardier --fasthttp -c ${concurrency} -d ${duration}s -l -m POST -H "Content-Type: application/json" -b '{"limit":10}' --format json -p r ${url}`

  const raw = execSync(cmd, { encoding: 'utf-8', timeout: (duration + 10) * 1000 })
  const data = JSON.parse(raw)

  // Latency values from bombardier are in µs (with -l flag, percentiles are available)
  return {
    avg: Math.round(data.result.latency.mean),
    p50: Math.round(data.result.latency.percentiles['50']),
    p95: Math.round(data.result.latency.percentiles['95']),
    p99: Math.round(data.result.latency.percentiles['99']),
    rps: Math.round(data.result.rps.mean),
  }
}

function median(arr: BombardierResult[]): BombardierResult {
  const sorted = [...arr].toSorted((a, b) => a.rps - b.rps)
  return sorted[Math.floor(sorted.length / 2)]!
}

function fmtRps(n: number): string {
  return n.toLocaleString()
}

// ── Frameworks ──

interface Framework {
  name: string
  server: string
}

const frameworks: Framework[] = [
  { name: 'Silgi', server: 'bench/servers/silgi.ts' },
  { name: 'Fastify', server: 'bench/servers/fastify.ts' },
  { name: 'Hono', server: 'bench/servers/hono.ts' },
  { name: 'Express', server: 'bench/servers/express.ts' },
]

// ── Run ──

console.log(`\nHTTP Throughput Benchmark (bombardier --fasthttp)`)
console.log(`Duration: ${BENCH_DURATION}s × ${ROUNDS} rounds, warmup: ${WARMUP_DURATION}s`)
console.log()

for (const concurrency of CONCURRENCY) {
  console.log(`## ${concurrency} concurrent connections\n`)
  console.log('| Framework | avg latency | p50 | p95 | p99 | req/s |')
  console.log('|---|---|---|---|---|---|')

  const rows: { name: string; r: BombardierResult }[] = []

  // Round-robin across rounds
  const allResults = new Map<string, BombardierResult[]>(frameworks.map((f) => [f.name, []]))

  for (let round = 0; round < ROUNDS; round++) {
    const offset = round % frameworks.length
    for (let i = 0; i < frameworks.length; i++) {
      const fw = frameworks[(i + offset) % frameworks.length]!
      const port = BASE_PORT + ((i + offset) % frameworks.length)

      // Start server as separate process
      const proc = spawn('node', ['--experimental-strip-types', fw.server], {
        env: { ...process.env, PORT: String(port) },
        stdio: 'pipe',
        cwd: process.cwd(),
      })

      // Collect stderr/stdout for debugging
      let output = ''
      proc.stdout?.on('data', (d: Buffer) => { output += d.toString() })
      proc.stderr?.on('data', (d: Buffer) => { output += d.toString() })

      try {
        await waitForPort(port)

        // Warmup (results discarded)
        runBombardier(port, '/users/list', concurrency, WARMUP_DURATION)

        // Actual measurement
        const result = runBombardier(port, '/users/list', concurrency, BENCH_DURATION)
        allResults.get(fw.name)!.push(result)
      } catch (err) {
        console.error(`  ✗ ${fw.name} failed (round ${round + 1}): ${err}`)
        console.error(`    Server output: ${output}`)
      } finally {
        proc.kill('SIGTERM')
        // Wait for process to exit
        await new Promise<void>((resolve) => {
          proc.once('exit', () => resolve())
          setTimeout(() => {
            proc.kill('SIGKILL')
            resolve()
          }, 2000)
        })
      }
    }
  }

  // Print results sorted by rps
  const sorted = frameworks
    .filter((fw) => allResults.get(fw.name)!.length > 0)
    .map((fw) => ({ name: fw.name, r: median(allResults.get(fw.name)!) }))
    .toSorted((a, b) => b.r.rps - a.r.rps)

  for (const { name, r } of sorted) {
    console.log(`| ${name} | ${r.avg}µs | ${r.p50}µs | ${r.p95}µs | ${r.p99}µs | ${fmtRps(r.rps)}/s |`)
  }

  console.log()
}
