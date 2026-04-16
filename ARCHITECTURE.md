# Silgi Architecture

This document is the map a new contributor (or an auditor) needs to
navigate the Silgi source tree. It covers the module layout, the shape
of a request, the "de-magic" invariants that the 2026-Q1 refactor
codified, and the intentional performance-critical module state that we
keep — and how to audit it.

## 1. Module layout

All runtime code lives under `src/`. Every subdirectory owns a single
concern:

| Directory              | Role                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/silgi.ts`         | Public `silgi()` factory. Wires per-instance state (schema registry, context bridge, hooks, storage). |
| `src/compile.ts`       | Pipeline compiler — unrolled guards, context pool, rou3 routing.                                      |
| `src/builder.ts`       | `ProcedureBuilder` chain (`$input`, `$use`, `$resolve`, …).                                          |
| `src/caller.ts`        | In-process caller used by `createCaller`.                                                             |
| `src/core/`            | Framework internals (request pipeline, codec, SSE, schema conversion, error, storage, task/cron).    |
| `src/core/handler.ts`  | `createFetchHandler` + `wrapHandler` — the single Fetch-API entry point.                             |
| `src/core/error.ts`    | `SilgiError` with cross-realm brand + `isSilgiError`.                                                |
| `src/core/schema-converter.ts` | Per-instance schema registry (no module globals).                                            |
| `src/core/context-bridge.ts`   | Per-instance `AsyncLocalStorage` factory.                                                    |
| `src/adapters/`        | Framework integrations (Express, Next.js, SvelteKit, Remix, Astro, SolidStart, AWS Lambda, NestJS, Peer, Message Port, Message). |
| `src/client/`          | The client proxy (`createClient`), server-side caller (`createServerClient`), and fetch / ws / openapi adapters. |
| `src/integrations/`    | Opt-in plumbing for Zod, Drizzle, Better Auth, React, TanStack Query, Pinia Colada, Hey-API, AI SDK. |
| `src/plugins/`         | Batteries: analytics, cache, CORS, cookies, ratelimit, OTel, Pino, batch-server.                     |
| `src/broker/`          | Pluggable pub/sub (NATS, Redis) for broker-backed subscriptions.                                     |
| `src/codegen/`         | OpenAPI / type codegen entry points.                                                                  |
| `src/codec/`           | Wire codecs (msgpack, devalue).                                                                       |
| `src/scalar.ts`        | Scalar API Reference UI mounted at `/reference`.                                                      |
| `src/ws.ts`            | WebSocket adapter over crossws.                                                                       |
| `lib/`                 | Curated re-exports of a few third-party libs so example code can import `silgi/ocache` etc.           |

## 2. Life of a request

```
┌──────────────┐   ┌───────────────────┐   ┌────────────────────┐
│  HTTP (srvx, │   │ createFetchHandler│   │ compileRouter →    │
│  Express, …) │──▶│ (src/core/        │──▶│ route.handler(ctx) │
└──────────────┘   │  handler.ts)      │   │ (src/compile.ts)   │
                   └────────┬──────────┘   └──────────┬─────────┘
                            │                         │
                    per-request ctx from              │
                    CTX_POOL (null-proto)             │
                            │                         │
                            ▼                         ▼
                   ┌───────────────────┐    ┌────────────────────┐
                   │ request:prepare   │    │ guards → wrappers  │
                   │ hook (analytics   │    │ → input schema     │
                   │ attaches trace)   │    │ → resolve()        │
                   └────────┬──────────┘    └──────────┬─────────┘
                            │                          │
                            └──────────┬───────────────┘
                                       ▼
                         ┌──────────────────────────┐
                         │ response:finalize hook   │
                         │ encodeResponse / SSE /   │
                         │ msgpack / ReadableStream │
                         └──────────────────────────┘
```

### Step by step

1. **Adapter** receives a platform-specific request (Node `IncomingMessage`,
   Next.js `Request`, Lambda event, etc.) and adapts it to a standard
   `Request`.
2. `createFetchHandler(routerDef, contextFactory, hooks, prefix, bridge)`
   is the single unified entry point. It compiles the router once (cached
   in a `WeakMap`) and returns a `(request: Request) => Response`.
3. **Routing** uses rou3's radix tree (same engine as h3/nitro).
4. A **pooled context** is acquired with `using ctx = createContext()`
   — a null-prototype object from `CTX_POOL`. `Symbol.dispose` returns it
   to the pool at scope end. Streaming responses call `detachContext(ctx)`
   so the stream wrapper takes ownership and releases on stream
   completion or cancel.
5. The user's `context(req)` factory is awaited and merged onto `ctx`.
6. `hooks.callHook('request:prepare', { request, ctx })` fires — this is
   the hook analytics uses to attach `ctx.trace`.
7. **Input parsing** combines JSON/form body, query string, and URL
   params.
8. **Pipeline execution** runs inside `bridge.run(ctx, …)` so ambient
   integrations (Drizzle, Better Auth) can read `silgi.currentContext()`.
   The compiled handler runs guards (up to 4 unrolled), wrappers, input
   schema validation, resolve, and output schema validation.
9. `hooks.callHook('response:finalize', { request, ctx, output })` fires.
10. `makeResponse` chooses the wire format (JSON / msgpack / devalue /
    SSE / raw `ReadableStream` / `Response`) and returns.

## 3. De-magic principles

The refactor that culminated in release 0.57 removed several kinds of
implicit global state. The following rules must hold for all new code:

### Per-instance state, not module globals

- `schemaRegistry` is built from `silgi({ schemaConverters })` and
  threaded explicitly through the handler, scalar and analytics
  wrappers. **No top-level `Map` holds converters.**
- `contextBridge` is created by `createContextBridge()` inside each
  `silgi()` call. Two instances in the same process cannot observe each
  other's ambient context.
- Lifecycle hooks are stored on a per-instance `Hookable` — never on
  `globalThis`.
- Storage init is driven by `await silgi.ready()`, not a fire-and-forget
  dynamic import.

### Explicit hook wiring for framework plugins

- Framework plugins (like analytics) mutate `ctx` through the
  `request:prepare` hook and read final output via `response:finalize`.
- There is no WeakMap keyed on `Request` identity anywhere in the
  pipeline — they were brittle across adapters that re-wrap the
  incoming request.

### No import-order-sensitive side effects

- `package.json` declares a narrow `sideEffects` array. Only the zod
  entry file was historically side-effectful; the refactor made it a
  pure re-export (`zodConverter`).
- Importing `silgi` alone must not pull in Zod, MsgPack, Scalar, the
  analytics dashboard, or any other heavy optional dependency.

### Symbol brands over WeakSet registries

- `SilgiError` is identified via a prototype-brand symbol
  (`Symbol.for('silgi.error.brand.v1')`). `instanceof SilgiError` works
  across `node:vm` realms / worker threads without a shared WeakSet.

### Typed, documented context keys

- `src/core/ctx-symbols.ts` is the one place where framework-internal
  `Symbol` keys are defined (`RAW_INPUT`).
- `src/core/context.ts` exports `BaseContext` so users see which keys
  Silgi reserves (`params`, `trace`).

### Opt-in process mutation

- `serve(router, { handleSignals: true })` is how you opt in to the
  `process.once('SIGINT' | 'SIGTERM')` wiring. The default is `false`.
- `server.close()` stops cron jobs regardless of `handleSignals`, so
  callers always have a deterministic shutdown path.

## 4. Performance-critical module state (intentionally kept)

These structures are module-scoped on purpose. They are covered here so
auditors understand *why* the de-magic rule does not apply and so future
refactors do not accidentally break them.

### `CTX_POOL` — `src/compile.ts`

A plain `Array` of up to **128** null-prototype objects, reused as
per-request context containers.

- `createContext()` pops from the pool (or creates a fresh
  `Object.create(null)`).
- `Symbol.dispose` wipes own keys and symbols, pushes back if the pool
  isn't full, and is invoked by `using` at scope end.
- `detachContext(ctx)` clears the disposer so callers (streaming
  response wrappers) can own the release.
- `releaseContext(ctx)` is the manual release path for streaming.

**Ownership rules.** Exactly one owner holds the disposer at any time.
The handler owns it until `makeResponse` either returns synchronously
(scope exit releases) or detaches it for a streaming body (the stream
wrapper's `pull`/`cancel` handlers call `releaseContext`). Never share a
pooled ctx across requests or put it in a `WeakMap`.

**Why it's safe.** The pool holds only structurally-empty objects. No
user data, no references, no function captures. Growth is bounded at
128 entries. The wipe loop runs O(keys) once per request, well under the
cost of parsing the request body.

### `routerCache` — `src/core/router-utils.ts`

`WeakMap<RouterDef, CompiledRouterFn>`. Caches the compiled router
function keyed by the user's router definition object. When the router
is eligible for GC (e.g. a dynamic router is no longer referenced), the
cache entry goes with it.

### `resolved` + `loading` WeakMaps — `src/lazy.ts`

Two `WeakMap<LazyRouter, …>`s: the first caches resolved module
exports, the second caches the in-flight `Promise` so concurrent
`resolveLazy` calls don't trigger duplicate imports. Both are keyed on
the `LazyRouter` handle, so they are GC-friendly. The `LazyRouter`
shape itself stays immutable — no mutable fields, no `Symbol` branding.

### `_warnedVendors` — `src/core/schema-converter.ts`

`Set<string>` holding vendor names for which we've emitted the
"no converter registered" `console.warn` at least once. This is the
only module-global state in the schema subsystem and it stores only
vendor-name strings — never user schemas, never request data. The
tradeoff: we deduplicate noisy warnings in long-running processes.

## 5. Extending Silgi

### Add a schema converter

1. Write an object implementing `SchemaConverter` (`vendor: string`,
   `toJsonSchema(schema, opts)`).
2. Export it alongside your library adapter.
3. Users register it explicitly:

   ```ts
   import { silgi } from 'silgi'
   import { myLibConverter } from 'silgi/my-lib'

   const k = silgi({
     context: (req) => ({ /* … */ }),
     schemaConverters: [myLibConverter],
   })
   ```

No side-effect imports, no module mutation.

### Add an adapter

Adapters live in `src/adapters/<name>.ts`. Each one uses one of two
factory helpers so the request/response plumbing stays consistent:

- `createFetchAdapter(handler, adapterOptions)` — for platforms that
  expose a standard `Request` / `Response` (SvelteKit, Next.js App
  Router, Remix, Astro, SolidStart, Lambda via hono, message-port).
- `createEventFetchAdapter(handler, adapterOptions)` — for event-loop
  frameworks that don't surface a `Request` directly (Express, NestJS,
  srvx-style peer adapters). The helper wires the raw event through an
  `AsyncLocalStorage` so downstream integrations can recover it.

Pattern: normalize the platform's event into a `Request`, pass it
through the provided handler, and translate the returned `Response`
back to the platform's response object. Never mutate the handler
itself; adapters are pure wrappers.

## 6. Testing philosophy

- **Vitest**, one spec file per concern (`test/handler.test.ts`,
  `test/analytics.test.ts`, etc.). Keep files focused enough that the
  filename tells the reader what broke.
- **No snapshots**. Snapshots encode drift and hide intent; assert on
  the concrete shape you care about. If the object is too verbose to
  inline, destructure the fields relevant to the test.
- **Cross-realm tests** go through `node:vm` (`test/errors-cross-realm.test.ts`
  exercises `SilgiError` brand propagation across `vm.createContext`).
- **Multi-instance tests** live in `test/multi-instance.test.ts` and
  ensure that two `silgi()` instances in the same process don't leak
  context through the bridge.
- **Lifecycle tests** (`test/lifecycle.test.ts`) cover `silgi.ready()`,
  opt-in signal handling, and `server.close()` idempotence.
- **Benchmarks** (`bench/`) are run manually before touching hot paths.
  `pnpm bench:memory` is the canonical check that `CTX_POOL` still
  eliminates per-request GC pressure.

## 7. Where to look next

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the dev-loop commands.
- [`SECURITY.md`](./SECURITY.md) for threat model and disclosure.
- [`docs/rfcs/0001-de-magic.md`](./docs/rfcs/0001-de-magic.md) for the
  commit-by-commit motivation behind the current shape.
