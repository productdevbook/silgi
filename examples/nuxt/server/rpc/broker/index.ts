import { z } from 'zod'

import { s } from '../instance'

// ── Broker demo: call a remote worker service via NATS ──

// Simulate a "remote" worker router that runs in a separate service.
// In production, this would be a different process/container.

export const workerRouter = s.router({
  ping: s.$resolve(() => ({ pong: true, from: 'worker', pid: process.pid })),
  uppercase: s.$input(z.object({ text: z.string() })).$resolve(({ input }) => ({ result: input.text.toUpperCase() })),
  fib: s.$input(z.object({ n: z.number().int().min(0).max(40) })).$resolve(({ input }) => {
    function fib(n: number): number {
      return n <= 1 ? n : fib(n - 1) + fib(n - 2)
    }
    return { n: input.n, result: fib(input.n) }
  }),
})

export type WorkerRouter = typeof workerRouter
