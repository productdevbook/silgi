# Katman vs Nitro/H3 — Performance Benchmark

Katman serve() vs Katman handler() (Nitro direct mode) vs H3 v2 native.

> 3000 sequential requests per scenario | Node v24.11.0

## Results

| Scenario | Katman serve() | Katman handler() | H3 v2 native |
|---|---|---|---|
| Health (no mw, no validation) | **75µs** 13,232/s | 81µs 12,299/s | 74µs 13,487/s |
| List (Zod validation) | **84µs** 11,929/s | 93µs 10,699/s | 90µs 11,074/s |
| Create (guard + Zod) | **76µs** 13,104/s | 87µs 11,551/s | 87µs 11,502/s |

## Percentiles

| Scenario | Mode | avg | p50 | p99 | req/s |
|---|---|---|---|---|---|
| Health | serve() | 75µs | 62µs | 203µs | 13,232 |
| Health | handler() | 81µs | 73µs | 148µs | 12,299 |
| Health | H3 v2 | 74µs | 68µs | 123µs | 13,487 |
| List | serve() | **84µs** | 75µs | 144µs | **11,929** |
| List | handler() | 93µs | 83µs | 156µs | 10,699 |
| List | H3 v2 | 90µs | 80µs | 156µs | 11,074 |
| Create | serve() | **76µs** | 69µs | 130µs | **13,104** |
| Create | handler() | 87µs | 79µs | 119µs | 11,551 |
| Create | H3 v2 | 87µs | 78µs | 159µs | 11,502 |

## Analysis

**Katman serve()** (raw Node.js HTTP):
- Fastest in validation + middleware scenarios (6-8% faster than H3)
- Health check is neck-and-neck with H3 (~1%)
- No Fetch API overhead — direct IncomingMessage/ServerResponse

**Katman handler()** (Fetch API — used by Nitro direct mode):
- ~7-10% overhead vs serve() due to Node→Request conversion
- Equal to H3 in guarded scenarios, slightly slower in simple ones
- This is what runs when you use `{ fetch: handler() }` with Nitro

**H3 v2 native**:
- Strong baseline — well optimized for simple routes
- Slightly slower when Zod validation is added (no compiled pipeline)
- p99 latency higher than Katman in guarded scenario (159µs vs 130µs)

## Takeaway

Katman serve() has the edge in **middleware-heavy** scenarios thanks to compiled pipelines and unrolled guard specialization. For simple health checks, H3 and Katman are effectively equal.

When running on Nitro (via `{ fetch: handler() }`), the Fetch API conversion adds ~10% overhead, but Katman's compiled pipeline compensates in complex scenarios — making it roughly **equal to H3** for real-world use cases.

## Reproduce

```bash
node --experimental-strip-types bench/vs-nitro.ts
```
