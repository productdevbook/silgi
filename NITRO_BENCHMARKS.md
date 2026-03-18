# Katman serve() vs Real Nitro v3 — Performance Benchmark

Real server processes, real HTTP requests. No mocking, no wrapping.

- **Katman**: `playground/server.ts` via `k.serve()` (raw Node.js HTTP + compiled pipeline)
- **Nitro**: `examples/nitro/server.ts` via `npx nitro dev` (real Nitro v3 runtime + Katman handler)

> 2000 sequential requests per scenario | Node v24.11.0

## Results

| Scenario | Katman serve() | Nitro (real) | Comparison |
|---|---|---|---|
| Health (no mw, no validation) | **102µs** 9,781/s | 238µs 4,208/s | **2.3x faster** |
| List users (Zod validation) | **108µs** 9,250/s | 231µs 4,322/s | **2.1x faster** |
| Create user (guard + Zod) | **108µs** 9,268/s | 223µs 4,484/s | **2.1x faster** |

## Percentiles

| Scenario | Server | avg | p50 | p99 | req/s |
|---|---|---|---|---|---|
| Health | Katman | **102µs** | 84µs | 423µs | **9,781** |
| Health | Nitro | 238µs | 217µs | 490µs | 4,208 |
| List | Katman | **108µs** | 93µs | 220µs | **9,250** |
| List | Nitro | 231µs | 219µs | 395µs | 4,322 |
| Create | Katman | **108µs** | 97µs | 189µs | **9,268** |
| Create | Nitro | 223µs | 213µs | 337µs | 4,484 |

## Why the difference?

**Katman serve()** is a raw Node.js HTTP server with:
- Direct `IncomingMessage`/`ServerResponse` — no Fetch API conversion
- Compiled pipeline — guards unrolled, handlers pre-linked at startup
- Context pooling — zero per-request allocation
- Fast pathname extraction — string ops, no `new URL()`

**Nitro** adds layers on top:
- srvx server abstraction
- H3 v2 middleware chain + error handling
- Node → Fetch Request conversion per request
- Dev mode overhead (file watcher, HMR, rolldown bundler)

> Note: Nitro dev mode includes watcher and HMR overhead. Production builds (`nitro build`) would be faster, but still carry the H3/srvx layer.

## Reproduce

```bash
node --experimental-strip-types bench/vs-nitro.ts
```
