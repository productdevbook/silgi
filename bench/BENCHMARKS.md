# Benchmarks

> Last updated: **2026-03-19** | Apple M3 Max | Node v24.11.0

## Pipeline Performance (pure execution, no HTTP)

| Scenario | Katman | oRPC | H3 v2 | vs oRPC | vs H3 |
|---|---|---|---|---|---|
| No middleware | **111 ns** | 685 ns | 2,025 ns | **6.2x** | **18.2x** |
| Zod input validation | **241 ns** | 804 ns | 4,214 ns | **3.3x** | **17.5x** |
| 3 middleware + Zod | **297 ns** | 1,718 ns | 3,954 ns | **5.8x** | **13.3x** |
| 5 middleware + Zod | **413 ns** | 2,219 ns | 3,917 ns | **5.4x** | **9.5x** |

## HTTP Performance (Katman vs oRPC vs H3 vs Hono)

3000 sequential requests per scenario.

| Scenario | Katman | oRPC | H3 v2 | Hono |
|---|---|---|---|---|
| Simple (no mw) | **79µs** (12,592/s) | 83µs (12,048/s) | 78µs (12,753/s) | 74µs (13,516/s) |
| Zod validation | **86µs** (11,627/s) | 120µs (8,315/s) | 93µs (10,707/s) | 97µs (10,280/s) |
| Guard + Zod | **79µs** (12,706/s) | 116µs (8,625/s) | 96µs (10,359/s) | 102µs (9,799/s) |

### Comparison

| | Simple | Zod | Guard + Zod |
|---|---|---|---|
| Katman vs oRPC | ~tied | **1.4x faster** | **1.5x faster** |
| Katman vs H3 | ~tied | **1.1x faster** | **1.2x faster** |
| Katman vs Hono | 0.9x | **1.1x faster** | **1.3x faster** |

### Tail Latency (p99, Guard + Zod)

| Framework | avg | p50 | p99 |
|---|---|---|---|
| **Katman** | **79µs** | **70µs** | **148µs** |
| oRPC | 116µs | 103µs | 223µs |
| H3 v2 | 96µs | 82µs | 236µs |
| Hono | 102µs | 87µs | 194µs |

## Katman vs Nitro v3 (real server)

2000 sequential requests.

| Scenario | Katman serve() | Nitro v3 (real) | |
|---|---|---|---|
| Health | **102µs** / 9,781/s | 238µs / 4,208/s | **2.3x faster** |
| List + Zod | **108µs** / 9,250/s | 231µs / 4,322/s | **2.1x faster** |
| Guard + Zod | **108µs** / 9,268/s | 223µs / 4,484/s | **2.1x faster** |

## Memory Usage

50K calls, 3 guards + Zod. `--expose-gc`.

| Framework | Bytes/call |
|---|---|
| **Katman** | ~40 bytes |
| oRPC | ~56 bytes (1.4x more) |

## How to run

```sh
node --experimental-strip-types bench/vs-all.ts     # Katman vs oRPC vs H3 vs Hono
node --experimental-strip-types bench/vs-nitro.ts   # vs real Nitro server
node --experimental-strip-types bench/pipeline.ts   # pipeline only
node --experimental-strip-types bench/http.ts       # HTTP detailed (Katman vs oRPC)
```
