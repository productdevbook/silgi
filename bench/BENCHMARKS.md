# Benchmarks

> Last updated: **2026-03-24** | Apple M3 Max | Node v24.11.0 | Bun 1.3.11

## HTTP — Bun 1.3.11

Simple POST endpoint returning JSON. 3000 sequential requests, 200 warmup. All frameworks use `Bun.serve()`.

| Framework | avg | p50 | p95 | p99 | req/s |
|---|---|---|---|---|---|
| Elysia | **44µs** | **43µs** | 50µs | 58µs | **22,572/s** |
| Silgi | 46µs | 45µs | 54µs | 65µs | 21,672/s |
| Hono | 46µs | 45µs | 51µs | 62µs | 21,957/s |

## HTTP — Node.js v24.11.0

Same endpoint. Silgi and Hono use Fetch API adapters (srvx / @hono/node-server). Fastify and Express use native `req`/`res`.

| Framework | avg | p50 | p95 | p99 | req/s |
|---|---|---|---|---|---|
| Fastify | **96µs** | **85µs** | 117µs | 197µs | **10,396/s** |
| Express | 102µs | 90µs | 130µs | 182µs | 9,811/s |
| Hono | 116µs | 105µs | 150µs | 190µs | 8,638/s |
| Silgi | 125µs | 111µs | 180µs | 259µs | 7,993/s |

Silgi uses the Fetch API (`Request`/`Response`) while Fastify and Express use native Node.js `req`/`res`. This adds ~20µs fixed adapter overhead per request.

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
