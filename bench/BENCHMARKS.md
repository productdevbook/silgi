# Benchmarks

> Last updated: **2026-03-24** | Apple M3 Max | Node v24.11.0 | Bun 1.3.11
>
> Methodology: 5000 sequential requests, 500 warmup, 3 rounds median. Response correctness verified.

## HTTP — Bun 1.3.11

Simple POST endpoint returning JSON. All frameworks use `Bun.serve()`.

| Framework | avg | p50 | p95 | p99 | req/s |
|---|---|---|---|---|---|
| Elysia | **44µs** | **42µs** | 53µs | 66µs | **22,865/s** |
| Hono | 45µs | 43µs | 53µs | 72µs | 22,265/s |
| Silgi | 51µs | 44µs | 83µs | 160µs | 19,634/s |

## HTTP — Node.js v24.11.0

Same endpoint. Silgi and Hono use Fetch API adapters (srvx / @hono/node-server). Fastify and Express use native `req`/`res`.

| Framework | avg | p50 | p95 | p99 | req/s |
|---|---|---|---|---|---|
| Fastify | **87µs** | **79µs** | 102µs | 152µs | **11,435/s** |
| Hono | 95µs | 85µs | 110µs | 187µs | 10,481/s |
| Silgi | 103µs | 92µs | 125µs | 194µs | 9,742/s |
| Express | 127µs | 93µs | 204µs | 817µs | 7,863/s |

Silgi uses the Fetch API (`Request`/`Response`) while Fastify and Express use native Node.js `req`/`res`. This adds ~10µs fixed adapter overhead per request.

## Pipeline Performance (pure execution, no HTTP)

| Scenario | Silgi | oRPC | H3 v2 | vs oRPC | vs H3 |
|---|---|---|---|---|---|
| No middleware | **111 ns** | 685 ns | 2,025 ns | **6.2x** | **18.2x** |
| Zod input validation | **241 ns** | 804 ns | 4,214 ns | **3.3x** | **17.5x** |
| 3 middleware + Zod | **297 ns** | 1,718 ns | 3,954 ns | **5.8x** | **13.3x** |
| 5 middleware + Zod | **413 ns** | 2,219 ns | 3,917 ns | **5.4x** | **9.5x** |

## Router Performance (Silgi compiled vs rou3)

| Scenario | Silgi | rou3 | |
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
| **Silgi** | ~40 bytes |
| oRPC | ~56 bytes (1.4x more) |

## How to run

```sh
node --experimental-strip-types bench/http.ts       # HTTP (Node.js)
bun bench/http-bun.ts                               # HTTP (Bun)
node --experimental-strip-types bench/router.ts     # Router: Silgi vs rou3
```
