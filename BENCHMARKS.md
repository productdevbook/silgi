# Benchmarks

> Auto-generated. Last updated: 2026-03-17

## Environment

| Key | Value |
|---|---|
| CPU | Apple M3 Max |
| Cores | 14 |
| Node.js | v24.11.0 |
| OS | darwin arm64 |

## Pipeline Performance (mitata)

Pure middleware pipeline execution — no HTTP, no serialization.

| Scenario | oRPC | Katman | Speedup |
|---|---|---|---|
| No middleware | 688 ns | **95 ns** | **7.2x** |
| Zod input validation | 846 ns | **220 ns** | **3.9x** |
| 3 middleware + Zod | 1693 ns | **304 ns** | **5.6x** |
| 5 middleware + Zod | 2271 ns | **416 ns** | **5.5x** |

## HTTP Performance (sequential requests)

Full request/response cycle over TCP — real-world latency.

| Scenario | Katman | H3 v2 | oRPC |
|---|---|---|---|
| Simple (no mw, no validation) | **78µs** (12762/s) | 85µs (11687/s) | 78µs (12875/s) |
| Zod input validation | **88µs** (11382/s) | 97µs (10316/s) | 112µs (8896/s) |
| Guard + Zod validation | **80µs** (12471/s) | 91µs (11004/s) | 110µs (9116/s) |

## How to run

```sh
pnpm bench           # oRPC vs Katman (pipeline)
pnpm bench:http      # Katman vs H3 v2 vs oRPC (HTTP)
pnpm bench:pipeline  # v1 vs v2 internal comparison
pnpm bench:micro     # per-operation bottleneck analysis
```
