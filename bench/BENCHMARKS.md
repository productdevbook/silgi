# Benchmarks

> Last updated: **2026-03-20** | Apple M3 Max | Node v24.11.0

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

## Router Performance (Katman compiled vs rou3)

| Scenario | Katman | rou3 | |
|---|---|---|---|
| Static `/users/list` | **3.1 ns** | 3.9 ns | **1.23x faster** |
| Param `/users/123` | **22.0 ns** | 25.6 ns | **1.16x faster** |
| Deep `/users/1/posts/2` | **23.7 ns** | 26.6 ns | **1.12x faster** |
| Wildcard `/files/a/b/c` | **19.2 ns** | 91.3 ns | **4.75x faster** |
| Miss `/missing/deep` | **4.5 ns** | 22.3 ns | **4.96x faster** |

## Memory Usage

50K calls, 3 guards + Zod. `--expose-gc`.

| Framework | Bytes/call |
|---|---|
| **Katman** | ~40 bytes |
| oRPC | ~56 bytes (1.4x more) |

## How to run

```sh
node --experimental-strip-types bench/router.ts     # Router: Katman vs rou3
```
