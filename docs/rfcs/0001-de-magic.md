# RFC 0001 — De-Magic Refactor

**Status:** Complete (shipped 0.52 → 0.57).
**Authors:** Silgi core team.
**Reviewers:** External contributors via GitHub.
**Last updated:** 2026-04-16.

## Summary

Silgi 0.51 carried a handful of "convenience through magic" patterns
inherited from earlier prototypes: module-scoped mutable registries,
import-order side effects, untyped `ctx.__foo` keys, and hidden
`process.once` hooks. This RFC records why those patterns were removed,
what each phase swapped them for, and which intentional performance
optimisations (null-prototype context pool, `routerCache`, lazy loader
WeakMaps) we explicitly kept.

## Motivation

Four recurring pain points drove the refactor:

1. **Predictability.** `import 'silgi/zod'` auto-registered a converter
   via a module-level `Map`. Combined with `"sideEffects": false` in
   `package.json`, strict tree-shakers would silently drop the
   registration call — the symptom was "OpenAPI works locally, vanishes
   in prod".
2. **Testability.** Two `silgi()` instances in one process shared a
   global `AsyncLocalStorage` through `getCtx()` / `runWithCtx()`. Any
   test that booted a second instance risked context bleed.
3. **Auditability.** Framework internals wrote `ctx.__analyticsTrace`
   without a type for contributors to find.
4. **Boot semantics.** `silgi()` silently called `initStorage()` in a
   fire-and-forget `.then()` and registered `process.once('SIGINT')`
   from inside `serve()`. Neither was declared in the public API.

All four categories had ad-hoc workarounds and, pre-1.0, were safe to
address with breaking changes.

## Phased outcome

Each phase landed as a single commit on `main`. SHAs below refer to the
commits in `git log` order.

### Phase 1 — `sideEffects` hotfix (`3b581be`)

`package.json` used `"sideEffects": false`, which allowed bundlers to
drop the zod converter's registration call. The hotfix declared the
zod entry file as explicitly side-effectful so the registration
survived tree-shaking, unblocking the later phases.

### Phase 2 — Error registry cleanup (`c6dd5c7`)

Removed the `globalThis[Symbol.for('silgi.error.registry')]` WeakSet in
favour of a prototype-branded `Symbol.for('silgi.error.brand.v1')`.
`SilgiError` now advertises identity via `Symbol.hasInstance` as an
O(1) brand check; `instanceof SilgiError` and the new `isSilgiError()`
helper both work across worker threads and `node:vm` realms without
any shared mutable state.

### Phase 3 — Explicit schema converters (`6902b25`, breaking)

Deleted the module-scoped converter `Map` and made
`silgi({ schemaConverters: [zodConverter] })` the only registration
path. `silgi/zod` no longer has import side effects; users pass the
exported `zodConverter` by hand. Schemas exposing the native
`jsonSchema.input()` fast path still work without any converter.

### Phase 4 — Analytics trace via hooks (`b17405e`, breaking)

Deleted `src/core/trace-map.ts` (a WeakMap keyed on `Request`) and
introduced two internal hooks: `request:prepare` (fires after base
context is applied) and `response:finalize` (fires before the Response
is built). The analytics plugin attaches `ctx.trace` through
`request:prepare` and captures output through `response:finalize`,
which means adapters that re-wrap the incoming request no longer lose
their trace link.

### Phase 5 — Per-instance context bridge (`2acac90`)

Replaced the module-level `AsyncLocalStorage` in `context-bridge.ts`
with a `createContextBridge()` factory. Each `silgi()` call owns its
own bridge and exposes `runInContext(ctx, fn)` / `currentContext()` on
the instance. Drizzle and Better Auth integrations now require a
`{ silgi }` argument so they can target the right bridge — fixing the
long-standing bug where two instances in the same process cross-talked
through ambient context.

### Phase 6 — Typed ctx keys (`0b1483a`)

`ctx.__analyticsTrace` (and any other `__`-prefixed keys) are gone.
`src/core/ctx-symbols.ts` centralises framework-internal `Symbol` keys
(currently just `RAW_INPUT`), and `src/core/context.ts` exports a
`BaseContext` interface documenting the reserved keys (`params`,
`trace`). The pipeline still runs `ctx` as a loose
`Record<string, unknown>` at runtime; the interface is purely for
contributor orientation and TypeScript users.

### Phase 7 — Lifecycle: signal + storage (`c302e38`)

`silgi()` now builds a `ready: Promise<void>` at creation time:
storage init runs lazily, errors reject the promise rather than going
to `console.error`, and `useStorage()` awaits it internally. `serve()`
grew a `handleSignals` option (default `false`) so
`process.once('SIGINT' | 'SIGTERM')` is opt-in. The srvx `server.close`
is wrapped in a non-mutating `Object.assign` shim that always stops
cron jobs on explicit shutdown.

### Phases 8 & 9 — JSDoc + documented module state

Phase 8 introduced `typedoc.json` with validation (invalid links,
not-exported references) as a CI-checkable gate, and swept the public
API for missing `@param` / `@returns` / `@example` tags.

Phase 9 is documentation-only: it enumerates the performance-critical
module state we intentionally keep (`CTX_POOL`, `routerCache`,
`resolved`/`loading` in `lazy.ts`, `_warnedVendors`) and explains the
ownership rules so future refactors don't sweep them away by accident.
See [`ARCHITECTURE.md`](../../ARCHITECTURE.md) §4 for the full list.

## What we did not change

- **`CTX_POOL`** (`src/compile.ts`) — bounded 128-slot pool of
  null-prototype objects. Wiped on dispose, never stores user data.
  Essential to the memory benchmark; keeping it.
- **`routerCache`** (`src/core/router-utils.ts`) — `WeakMap` of
  `RouterDef → CompiledRouterFn`. GC-friendly memoization with no
  surface for state leakage.
- **`resolved` + `loading`** WeakMaps in `src/lazy.ts` — race-safe
  lazy resolver cache. Both keyed on the `LazyRouter` handle.
- **`_warnedVendors`** (`src/core/schema-converter.ts`) — deduplicates
  the "no converter registered" warning in long-running processes.
  Stores strings only.

These are documented in `ARCHITECTURE.md` so auditors can confirm they
remain safe.

## Migration notes

The breaking changes from this RFC cluster in 0.53 (schema converters)
and 0.54 (analytics hooks). User-facing migration guidance is in the
[silgi.dev](https://silgi.dev) migration page; the short version is:

```ts
// Before 0.53
import 'silgi/zod'
const k = silgi({ context: (req) => ({ /* … */ }) })

// 0.53+
import { zodConverter } from 'silgi/zod'
const k = silgi({
  context: (req) => ({ /* … */ }),
  schemaConverters: [zodConverter],
})
```

```ts
// Before 0.55
const auth = betterAuth({ /* … */ })
// After 0.55
const auth = betterAuth({ /* … */, silgi: k })
```

```ts
// Before 0.57 — SIGINT auto-wired
await k.serve(router)
// 0.57+ — opt-in
await k.serve(router, { handleSignals: true })
```

## References

- `git log --oneline` between `1423e00` and `c302e38` for the commit
  history.
- [`ARCHITECTURE.md`](../../ARCHITECTURE.md) for the current request
  pipeline and performance invariants.
- [`SECURITY.md`](../../SECURITY.md) for the threat model that
  informed several of the decisions above (analytics auth, prototype
  sanitization, error redaction).
